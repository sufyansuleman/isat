// Analysis model for uploaded-file results: oriented index columns, lazy transforms / statistics and a cached
// Spearman matrix. No DOM. Values are the oriented values the user selected (the ones that are downloaded).
import {
  describe, spearmanMatrix, transform,
  type Described, type SpearmanMatrix, type TransformKind, type TransformResult,
} from '@isat/core';
import { INCLUDED, NEGATED, SEP, columnName, type ChunkPayload } from './batch';

export interface TransformSetting { kind: TransformKind; bySex: boolean }
export const NO_TRANSFORM: TransformSetting = { kind: 'none', bySex: false };

export const KIND_LABEL: Record<TransformKind, string> = {
  none: 'None', log: 'Natural log', z: 'z-score', rint: 'Rank-based inverse normal (RINT, Blom)',
};
const KIND_SUFFIX: Record<Exclude<TransformKind, 'none'>, string> = { log: 'log', z: 'z', rint: 'rint' };

/** Column-name suffix, e.g. "_rint_bysex"; '' when no transform. */
export function transformSuffix(t: TransformSetting): string {
  return t.kind === 'none' ? '' : `_${KIND_SUFFIX[t.kind]}${t.bySex ? '_bysex' : ''}`;
}

/** One plain sentence under the transform control. */
export function transformExplanation(t: TransformSetting): string {
  const base = {
    none: 'Values are shown and downloaded as calculated.',
    log: 'Natural logarithm (base e) of the selected values; values ≤ 0 are set to missing.',
    z: 'Each value minus the mean, divided by the sample SD (n − 1), over the non-missing values.',
    rint: 'Ranks mapped to a normal distribution (Blom offset 3/8), commonly used before genetic association analysis.',
  }[t.kind];
  return t.kind !== 'none' && t.bySex ? `${base} Applied separately in each sex.` : base;
}

/** Axis label for an index under a transform. */
export function transformedLabel(name: string, t: TransformSetting): string {
  const f = { none: name, log: `ln(${name})`, z: `z(${name})`, rint: `RINT(${name})` }[t.kind];
  return t.kind !== 'none' && t.bySex ? `${f}, within sex` : f;
}

/** Category order used by the summary and the heatmap. */
export const CATEGORIES: Array<[string, string]> = [
  ['fasting', 'Fasting'], ['ogtt', 'OGTT'], ['lipid', 'Lipid & body measures'], ['tracer_dxa', 'Tracer & DXA'],
];

/** INCLUDED positions ordered by category, then by name. */
export const HEATMAP_ORDER: number[] = (() => {
  const rank = (c: string) => { const k = CATEGORIES.findIndex(([id]) => id === c); return k < 0 ? CATEGORIES.length : k; };
  return INCLUDED.map((_, i) => i).sort((a, b) => rank(INCLUDED[a]!.category) - rank(INCLUDED[b]!.category) || INCLUDED[a]!.name.localeCompare(INCLUDED[b]!.name));
})();

export interface Matrix extends SpearmanMatrix {
  /** INCLUDED positions in display order (>= 3 non-missing values). */
  cols: number[];
  labels: string[];
}

export class Analysis {
  readonly total: number;
  private rawCols = new Map<number, Float64Array>();
  private stats = new Map<number, Described>();
  private tf = new Map<string, TransformResult>();
  private matrices = new Map<string, Matrix>();

  constructor(
    private chunks: ChunkPayload[],
    readonly mode: 'published' | 'sensitivity',
    /** Sex label per row ('male' | 'female' | null). */
    readonly sexes: Array<string | null>,
  ) {
    this.total = sexes.length;
  }

  /** Oriented values of index `c` (position in INCLUDED); NaN = missing. */
  raw(c: number): Float64Array {
    let col = this.rawCols.get(c);
    if (col) return col;
    col = new Float64Array(this.total).fill(NaN);
    const flip = this.mode === 'sensitivity' && NEGATED.has(INCLUDED[c]!.id);
    let r = 0;
    for (const ch of this.chunks) {
      for (const cell of ch.vals[c]!.split(SEP)) {
        if (cell !== '') { const v = Number(cell); col[r] = flip ? (v === 0 ? 0 : -v) : v; }
        r++;
      }
    }
    this.rawCols.set(c, col);
    return col;
  }

  /** Statistics of the raw (untransformed) oriented values. */
  rawStats(c: number): Described {
    let d = this.stats.get(c);
    if (!d) this.stats.set(c, d = describe(this.raw(c)));
    return d;
  }

  /** Raw values <= 0 (what the log transform would set to missing). */
  nonPositive(c: number): number {
    let k = 0;
    for (const v of this.raw(c)) if (v <= 0) k++;
    return k;
  }

  transformed(c: number, t: TransformSetting): TransformResult {
    const key = `${c}|${t.kind}|${t.bySex && t.kind !== 'none'}`;
    let r = this.tf.get(key);
    if (!r) {
      r = t.kind === 'none'
        ? { values: this.raw(c), nonPositive: 0, reasons: [], groupN: {}, noGroup: 0 }
        : transform(this.raw(c), t.kind, t.bySex ? { groups: this.sexes } : {});
      this.tf.set(key, r);
    }
    return r;
  }

  /** Spearman is rank-based, so z / RINT only matter within sex; log also changes which values are present. */
  private matrixKey(t: TransformSetting): string {
    if (t.kind === 'none' || (!t.bySex && t.kind !== 'log')) return 'raw';
    return t.bySex ? `${t.kind}:sex` : 'log';
  }

  hasMatrix(t: TransformSetting): boolean { return this.matrices.has(this.matrixKey(t)); }

  /** Spearman matrix over indices with >= 3 non-missing (transformed) values; computed once per setting. */
  matrix(t: TransformSetting): Matrix {
    const key = this.matrixKey(t);
    let m = this.matrices.get(key);
    if (m) return m;
    const use: TransformSetting = key === 'raw' ? NO_TRANSFORM : t;
    const cols = HEATMAP_ORDER.filter((c) => {
      const v = this.transformed(c, use).values;
      let n = 0;
      for (let i = 0; i < v.length && n < 3; i++) if (!Number.isNaN(v[i]!)) n++;
      return n >= 3;
    });
    const sm = spearmanMatrix(cols.map((c) => this.transformed(c, use).values));
    m = { ...sm, cols, labels: cols.map((c) => INCLUDED[c]!.name) };
    this.matrices.set(key, m);
    return m;
  }

  /** Transformed values of every index, for the results CSV (INCLUDED order). */
  transformedColumns(t: TransformSetting): Float64Array[] {
    return INCLUDED.map((_, c) => this.transformed(c, t).values);
  }
}

export function matrixCsv(m: Matrix, mode: 'published' | 'sensitivity', what: 'rho' | 'n'): string {
  const names = m.cols.map((c) => columnName(INCLUDED[c]!.id, mode));
  const lines = [['index', ...names].join(',')];
  for (let i = 0; i < m.k; i++) {
    const cells = names.map((_, j) => {
      const v = what === 'rho' ? m.rho[i * m.k + j]! : m.n[i * m.k + j]!;
      return what === 'rho' && Number.isNaN(v) ? '' : String(v);
    });
    lines.push([names[i]!, ...cells].join(','));
  }
  return lines.join('\r\n') + '\r\n';
}


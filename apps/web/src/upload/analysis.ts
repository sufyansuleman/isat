// Analysis model for uploaded-file results: oriented index columns, lazy transforms / statistics and a cached
// Spearman matrix. No DOM. Values are the oriented values the user selected (the ones that are downloaded).
import {
  describe, kde, spearmanMatrix, transform,
  type Described, type Kde, type SpearmanMatrix, type TransformKind, type TransformResult,
} from '@isat/core';
import { INCLUDED, NEGATED, SEP, columnName, type ChunkPayload } from './batch';

/** One density curve (or one sex group) of an index under a transform. */
export interface GroupDensity { key: 'male' | 'female' | 'all'; n: number; median: number; kde: Kde }
export interface SexSplit { male: Float64Array; female: Float64Array; /** Non-missing values on rows without a recognised sex. */ noSex: number }

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
  private splits = new Map<string, SexSplit>();
  private dens = new Map<string, GroupDensity>();

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

  /** True when at least one row has a recognised sex (male / female). */
  get hasSex(): boolean { return this.sexes.some((s) => s === 'male' || s === 'female'); }

  private static tfKey(c: number, t: TransformSetting): string { return `${c}|${t.kind}|${t.bySex && t.kind !== 'none'}`; }

  /** Values of index `c` under `t` restricted to men / women (NaN elsewhere removed). */
  sexSplit(c: number, t: TransformSetting): SexSplit {
    const key = Analysis.tfKey(c, t);
    let r = this.splits.get(key);
    if (r) return r;
    const v = this.transformed(c, t).values;
    const m: number[] = [], f: number[] = [];
    let noSex = 0;
    for (let i = 0; i < v.length; i++) {
      const x = v[i]!;
      if (Number.isNaN(x)) continue;
      const s = this.sexes[i];
      if (s === 'male') m.push(x); else if (s === 'female') f.push(x); else noSex++;
    }
    this.splits.set(key, r = { male: Float64Array.from(m), female: Float64Array.from(f), noSex });
    return r;
  }

  /** Kernel density (bw.nrd0), n and median of one group of index `c` under `t`; cached. */
  density(c: number, t: TransformSetting, group: 'male' | 'female' | 'all'): GroupDensity {
    const key = `${Analysis.tfKey(c, t)}|${group}`;
    let r = this.dens.get(key);
    if (r) return r;
    const vals = group === 'all' ? this.transformed(c, t).values : this.sexSplit(c, t)[group];
    const d = describe(vals);
    this.dens.set(key, r = { key: group, n: d.n, median: d.median ?? NaN, kde: kde(vals) });
    return r;
  }

  /** Median and n of the raw values in men and women (null when the sex has no values). */
  sexMedians(c: number): { male: { median: number | null; n: number }; female: { median: number | null; n: number } } {
    const s = this.sexSplit(c, NO_TRANSFORM);
    const one = (a: Float64Array) => { const d = describe(a); return { median: d.median, n: d.n }; };
    return { male: one(s.male), female: one(s.female) };
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
    const key = Analysis.tfKey(c, t);
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


/** Long-format density CSV: one row per grid point and group. */
export function densityCsv(rows: Array<{ index: string; scale: string; curves: Array<{ group: string; n: number; kde: Kde }> }>): string {
  const lines = ['index,scale,group,n,bandwidth,x,density'];
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  for (const r of rows) {
    for (const c of r.curves) {
      c.kde.x.forEach((x, i) => lines.push([q(r.index), q(r.scale), c.group, c.n, c.kde.bw, x, c.kde.y[i]!].join(',')));
    }
  }
  return lines.join('\r\n') + '\r\n';
}

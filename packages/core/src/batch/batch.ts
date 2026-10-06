import { resolveSettings, type ConversionSettings } from '../units';
import type { Inputs, Result } from '../types';
import { AVIGNON_1999_WEIGHT, avignonSi0, avignonSi120, type AvignonWeightSource } from '../indices/ogtt';
import { registry, type MethodEntry } from '../registry';
import type { TransformKind } from '../transform';
import { CHUNK_ROWS } from './limits';
import { insertAfter, transformBlock, transformedRowFields } from './transformcsv';

/** Methods that get an output column (deferred/excluded methods never calculate). */
export const INCLUDED: MethodEntry[] = registry.filter((m) => m.deferredReason === undefined);

/** Same rule as core orient(): resistant-direction methods whose legacy relation is "negated" get the _inv convention. */
export const NEGATED = new Set(
  INCLUDED.filter((m) => m.legacy.relation === 'negated' && m.direction === 'higher_more_resistant').map((m) => m.id),
);

export type AvignonChoice = 'default' | 'cohort';
export interface AvignonUse { w: number; source: AvignonWeightSource; warnings: string[] }

const SAMPLE_WARNING = 'Sample-derived Avignon coefficient (InsuSensCalc / Suleman 2024 variant; ratio of mean Si120 to mean Si0 in the analysed cohort): the result depends on the cohort analysed.';

/** Incremental form of the sample-derived Avignon weight (same summation order as the all-rows version). */
export class AvignonAccumulator {
  private s0 = 0; private s1 = 0; private n = 0;
  private readonly s: ConversionSettings;
  constructor(settings: Partial<ConversionSettings>) { this.s = resolveSettings(settings); }
  /** Rows in canonical units. */
  add(rows: Inputs[]): void {
    for (const r of rows) {
      const a = avignonSi0(r, this.s), b = avignonSi120(r, this.s);
      if (a.status === 'ok' && b.status === 'ok') { this.s0 += a.value as number; this.s1 += b.value as number; this.n++; }
    }
  }
  get pairs(): number { return this.n; }
  result(): AvignonUse {
    if (this.n >= 2) return { w: (this.s1 / this.n) / (this.s0 / this.n), source: 'sample', warnings: [SAMPLE_WARNING] };
    return {
      w: AVIGNON_1999_WEIGHT, source: 'avignon_1999',
      warnings: ['Fewer than 2 rows have both Si0 and Si120; sample weight unavailable, using 0.137 (Avignon 1999).'],
    };
  }
}

/** Mirrors core calculateBatch weight semantics (explicit weight passed to each row run). */
export function resolveAvignon(rows: Inputs[], settings: Partial<ConversionSettings>, choice: AvignonChoice): AvignonUse {
  if (choice === 'default') return { w: AVIGNON_1999_WEIGHT, source: 'avignon_1999', warnings: [] };
  const acc = new AvignonAccumulator(settings);
  acc.add(rows);
  return acc.result();
}

/** All registry results for one participant (Belfiore default reference set; Avignon weight as given). */
export function runRow(inputs: Inputs, settings: Partial<ConversionSettings>, av: AvignonUse): Result[] {
  const s = resolveSettings(settings);
  return registry.map((m) => m.run(inputs, s, undefined, { avignon: { w: av.w, source: av.source, warnings: av.warnings } }));
}

// ---------- counters ----------
export interface MethodCount {
  ok: number; unavailable: number; error: number;
  unavailableReasons: Record<string, number>; errorReasons: Record<string, number>;
}
export type Counts = Record<string, MethodCount>;

export const emptyCounts = (): Counts =>
  Object.fromEntries(INCLUDED.map((m) => [m.id, { ok: 0, unavailable: 0, error: 0, unavailableReasons: {}, errorReasons: {} }]));

const addMap = (a: Record<string, number>, b: Record<string, number>) => { for (const [k, v] of Object.entries(b)) a[k] = (a[k] ?? 0) + v; };

export function mergeCounts(into: Counts, delta: Counts): void {
  for (const [id, d] of Object.entries(delta)) {
    const t = into[id]!;
    t.ok += d.ok; t.unavailable += d.unavailable; t.error += d.error;
    addMap(t.unavailableReasons, d.unavailableReasons); addMap(t.errorReasons, d.errorReasons);
  }
}

export function topReasons(m: Record<string, number>, n = 3): Array<[string, number]> {
  return Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

// ---------- chunk processing (pure) ----------
export const SEP = '\u001e'; // joins per-row cells inside a chunk (never appears in numbers/status words)

export interface ChunkPayload {
  /** CSV-escaped participant IDs, joined by SEP. */
  ids: string;
  /** CSV-escaped input-problem text per row, joined by SEP. */
  problems: string;
  /** Per included method: value strings (published orientation, full precision, '' = not calculated), joined by SEP. */
  vals: string[];
  /** Per included method: status words, joined by SEP. */
  status: string[];
}

export const csvField = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function processChunk(
  rows: Inputs[], ids: string[], settings: Partial<ConversionSettings>, av: AvignonUse, problems: string[] = [],
): { payload: ChunkPayload; counts: Counts } {
  const counts = emptyCounts();
  const vals: string[][] = INCLUDED.map(() => []);
  const status: string[][] = INCLUDED.map(() => []);
  const idx = new Map(registry.map((m, k) => [m.id, k]));
  rows.forEach((row) => {
    const res = runRow(row, settings, av);
    INCLUDED.forEach((m, c) => {
      const r = res[idx.get(m.id)!]!;
      const ct = counts[m.id]!;
      vals[c]!.push(r.status === 'ok' && r.value !== null ? String(r.value) : '');
      status[c]!.push(r.status);
      if (r.status === 'ok') ct.ok++;
      else {
        const key = r.reasons.join('; ') || '(no reason given)';
        if (r.status === 'error') { ct.error++; ct.errorReasons[key] = (ct.errorReasons[key] ?? 0) + 1; }
        else { ct.unavailable++; ct.unavailableReasons[key] = (ct.unavailableReasons[key] ?? 0) + 1; }
      }
    });
  });
  return {
    payload: { ids: ids.map(csvField).join(SEP), problems: ids.map((_, k) => csvField(problems[k] ?? "")).join(SEP), vals: vals.map((v) => v.join(SEP)), status: status.map((v) => v.join(SEP)) },
    counts,
  };
}

// ---------- worker protocol ----------
export interface RunRequest {
  type: 'run';
  rows: Inputs[]; // canonical units
  ids: string[];
  /** Per-row input problem text (same order as ids). */
  problems?: string[];
  settings: Partial<ConversionSettings>;
  avignon: AvignonChoice;
  chunkRows?: number;
}
export type WorkerMessage =
  | { type: 'weight'; use: AvignonUse }
  | { type: 'chunk'; index: number; done: number; total: number; payload: ChunkPayload; counts: Counts }
  | { type: 'done' }
  | { type: 'error'; message: string };

/** Drives a whole run as a sequence of messages; the Worker just posts each one. */
export function* runBatch(req: RunRequest): Generator<WorkerMessage> {
  const size = req.chunkRows ?? CHUNK_ROWS;
  const total = req.rows.length;
  const use = resolveAvignon(req.rows, req.settings, req.avignon);
  yield { type: 'weight', use };
  for (let start = 0, index = 0; start < total; start += size, index++) {
    const end = Math.min(start + size, total);
    const { payload, counts } = processChunk(req.rows.slice(start, end), req.ids.slice(start, end), req.settings, use, req.problems?.slice(start, end));
    yield { type: 'chunk', index, done: end, total, payload, counts };
  }
  yield { type: 'done' };
}

// ---------- output assembly ----------
const negate = (s: string) => (s === '' || s === '0' ? s : s[0] === '-' ? s.slice(1) : '-' + s);

export function columnName(id: string, orientation: 'published' | 'sensitivity'): string {
  return orientation === 'sensitivity' && NEGATED.has(id) ? `${id}_inv` : id;
}

/** Transformed values to add after each index column: suffix (e.g. "_rint_bysex") and one full-length column per INCLUDED method (NaN = missing). */
export interface TransformedColumns { suffix: string; cols: ArrayLike<number>[] }

/** Positions of the index columns in the results CSV (after participant_id and input_problems). */
const tfPositions = (): number[] => INCLUDED.map((_, k) => k + 2);

/** CSV header line (with line ending). */
export function csvHead(orientation: 'published' | 'sensitivity', includeStatus: boolean, tf?: TransformedColumns): string {
  const names = INCLUDED.map((m) => columnName(m.id, orientation));
  const fields = ['participant_id', 'input_problems', ...names, ...(includeStatus ? names.map((n) => `${n}_status`) : [])];
  return (tf ? insertAfter(fields, tfPositions(), names.map((n) => n + tf.suffix)) : fields).join(',') + '\r\n';
}

/** CSV data lines (each with line ending) for one chunk; offset = rows before this chunk (for transformed columns). */
export function csvChunkText(
  ch: ChunkPayload, orientation: 'published' | 'sensitivity', includeStatus: boolean, tf?: TransformedColumns, offset = 0,
): string {
  const ids = ch.ids.split(SEP);
  const probs = ch.problems.split(SEP);
  const cols = ch.vals.map((v, c) => {
    const cells = v.split(SEP);
    return orientation === 'sensitivity' && NEGATED.has(INCLUDED[c]!.id) ? cells.map(negate) : cells;
  });
  const stat = includeStatus ? ch.status.map((s) => s.split(SEP)) : [];
  const pos = tfPositions();
  const lines: string[] = [];
  for (let r = 0; r < ids.length; r++) {
    const fields = [ids[r]!, probs[r]!, ...cols.map((c) => c[r]!), ...stat.map((c) => c[r]!)];
    lines.push((tf ? transformedRowFields(fields, pos, tf.cols.map((c) => c[offset + r]!)) : fields).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/** CSV text parts (join to get the file). Empty = not calculated; never 0. */
export function composeCsv(
  chunks: ChunkPayload[], orientation: 'published' | 'sensitivity', includeStatus: boolean, tf?: TransformedColumns,
): string[] {
  const parts: string[] = [csvHead(orientation, includeStatus, tf)];
  let offset = 0;
  for (const ch of chunks) {
    parts.push(csvChunkText(ch, orientation, includeStatus, tf, offset));
    offset += ch.ids.split(SEP).length;
  }
  return parts;
}

export interface SettingsFileInput {
  version: string; timestamp: string; fileName: string; delimiter: string;
  units: Record<string, string>; settings: Partial<ConversionSettings>;
  avignon: AvignonUse; orientation: 'published' | 'sensitivity'; includeStatus: boolean;
  rows: { total: number; withProblems: number; calculated: number };
  /** Unit plausibility check (transparency only; never changes the data). */
  unitCheck?: Array<{ quantity: string; column: string; median: number; n: number; selected: string; suggested: string | null }>;
  /** Transform applied to the oriented values (Distributions, Correlations and the optional CSV columns). */
  transform?: { kind: TransformKind; withinSex: boolean; addedColumns: boolean; suffix: string };
}

export function settingsFile(i: SettingsFileInput): Record<string, unknown> {
  const s = resolveSettings(i.settings);
  return {
    isat_version: i.version,
    timestamp: i.timestamp,
    input_file: i.fileName,
    delimiter: i.delimiter,
    units: i.units,
    unit_check: (i.unitCheck ?? []).map((c) => ({ quantity: c.quantity, column: c.column, median: c.median, n: c.n, selected: c.selected, suggested: c.suggested })),
    conversion_factors: {
      glucose_mg_per_dL_per_mmol: s.glucose_mg_per_dL_per_mmol, insulin_pmol_per_uU: s.insulin_pmol_per_uU,
      tg_mg_per_dL_per_mmol: s.tg_mg_per_dL_per_mmol, hdl_mg_per_dL_per_mmol: s.hdl_mg_per_dL_per_mmol,
    },
    avignon_weight: { value: i.avignon.w, source: i.avignon.source },
    orientation: i.orientation,
    belfiore_reference_set: 'belfiore_1998',
    include_status_columns: i.includeStatus,
    transform: transformBlock(i.transform),
    row_counts: { total: i.rows.total, with_problems: i.rows.withProblems, rows_with_input_problems: i.rows.withProblems, calculated: i.rows.calculated },
    methods: INCLUDED.map((m) => ({
      id: m.id, name: m.name, csv_column: columnName(m.id, i.orientation),
      source_verification: m.source_verification,
    })),
  };
}

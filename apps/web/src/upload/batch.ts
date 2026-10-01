import {
  AVIGNON_1999_WEIGHT, avignonSi0, avignonSi120, registry, resolveSettings,
  type AvignonWeightSource, type ConversionSettings, type Inputs, type MethodEntry, type Result,
} from '@isat/core';
import { CHUNK_ROWS } from './limits';

/** Methods that get an output column (deferred/excluded methods never calculate). */
export const INCLUDED: MethodEntry[] = registry.filter((m) => m.deferredReason === undefined);

/** Same rule as core orient(): resistant-direction methods whose legacy relation is "negated" get the _inv convention. */
export const NEGATED = new Set(
  INCLUDED.filter((m) => m.legacy.relation === 'negated' && m.direction === 'higher_more_resistant').map((m) => m.id),
);

export type AvignonChoice = 'default' | 'cohort';
export interface AvignonUse { w: number; source: AvignonWeightSource; warnings: string[] }

/** Mirrors core calculateBatch weight semantics (explicit weight passed to each row run). */
export function resolveAvignon(rows: Inputs[], settings: Partial<ConversionSettings>, choice: AvignonChoice): AvignonUse {
  if (choice === 'default') return { w: AVIGNON_1999_WEIGHT, source: 'avignon_1999', warnings: [] };
  const s = resolveSettings(settings);
  const pairs = rows
    .map((r) => [avignonSi0(r, s), avignonSi120(r, s)] as const)
    .filter(([a, b]) => a.status === 'ok' && b.status === 'ok')
    .map(([a, b]) => [a.value as number, b.value as number] as const);
  if (pairs.length >= 2) {
    const m = (k: 0 | 1) => pairs.reduce((acc, p) => acc + p[k], 0) / pairs.length;
    return {
      w: m(1) / m(0), source: 'sample',
      warnings: ['Sample-derived Avignon coefficient (InsuSensCalc / Suleman 2024 variant; ratio of mean Si120 to mean Si0 in the analysed cohort): the result depends on the cohort analysed.'],
    };
  }
  return {
    w: AVIGNON_1999_WEIGHT, source: 'avignon_1999',
    warnings: ['Fewer than 2 rows have both Si0 and Si120; sample weight unavailable, using 0.137 (Avignon 1999).'],
  };
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

/** CSV text parts (join to get the file). Empty = not calculated; never 0. */
export function composeCsv(chunks: ChunkPayload[], orientation: 'published' | 'sensitivity', includeStatus: boolean): string[] {
  const names = INCLUDED.map((m) => columnName(m.id, orientation));
  const head = ['participant_id', 'input_problems', ...names, ...(includeStatus ? names.map((n) => `${n}_status`) : [])].join(',');
  const parts: string[] = [head + '\r\n'];
  for (const ch of chunks) {
    const ids = ch.ids.split(SEP);
    const probs = ch.problems.split(SEP);
    const cols = ch.vals.map((v, c) => {
      const cells = v.split(SEP);
      return orientation === 'sensitivity' && NEGATED.has(INCLUDED[c]!.id) ? cells.map(negate) : cells;
    });
    const stat = includeStatus ? ch.status.map((s) => s.split(SEP)) : [];
    const lines: string[] = [];
    for (let r = 0; r < ids.length; r++) {
      lines.push([ids[r]!, probs[r]!, ...cols.map((c) => c[r]!), ...stat.map((c) => c[r]!)].join(','));
    }
    parts.push(lines.join('\r\n') + '\r\n');
  }
  return parts;
}

export interface SettingsFileInput {
  version: string; timestamp: string; fileName: string; delimiter: string;
  units: Record<string, string>; settings: Partial<ConversionSettings>;
  avignon: AvignonUse; orientation: 'published' | 'sensitivity'; includeStatus: boolean;
  rows: { total: number; withProblems: number; calculated: number };
}

export function settingsFile(i: SettingsFileInput): Record<string, unknown> {
  const s = resolveSettings(i.settings);
  return {
    isat_version: i.version,
    timestamp: i.timestamp,
    input_file: i.fileName,
    delimiter: i.delimiter,
    units: i.units,
    conversion_factors: {
      glucose_mg_per_dL_per_mmol: s.glucose_mg_per_dL_per_mmol, insulin_pmol_per_uU: s.insulin_pmol_per_uU,
      tg_mg_per_dL_per_mmol: s.tg_mg_per_dL_per_mmol, hdl_mg_per_dL_per_mmol: s.hdl_mg_per_dL_per_mmol,
    },
    avignon_weight: { value: i.avignon.w, source: i.avignon.source },
    orientation: i.orientation,
    belfiore_reference_set: 'belfiore_1998',
    include_status_columns: i.includeStatus,
    row_counts: { total: i.rows.total, with_problems: i.rows.withProblems, rows_with_input_problems: i.rows.withProblems, calculated: i.rows.calculated },
    methods: registry.map((m) => ({
      id: m.id, name: m.name, included: m.deferredReason === undefined,
      csv_column: m.deferredReason === undefined ? columnName(m.id, i.orientation) : null,
      source_verification: m.source_verification,
    })),
  };
}

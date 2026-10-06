import { CANONICAL, toUnit, type ConversionSettings, type Unit } from '../units';
import type { Inputs, Series } from '../types';
import { parseWideRow } from '../io/wide';

/** Units chosen for the columns of a file. */
export interface UnitChoice {
  glucose: 'mmol/L' | 'mg/dL'; insulin: 'pmol/L' | 'uU/mL'; tg: 'mmol/L' | 'mg/dL'; hdl: 'mmol/L' | 'mg/dL'; ffa: 'mmol/L' | 'umol/L';
}
export const DEFAULT_UNIT_CHOICE: UnitChoice = { glucose: 'mmol/L', insulin: 'pmol/L', tg: 'mmol/L', hdl: 'mmol/L', ffa: 'mmol/L' };

export type DelimiterName = 'comma' | 'semicolon' | 'tab';
export const DELIMS: Record<DelimiterName, string> = { comma: ',', semicolon: ';', tab: '\t' };

/** Detect the delimiter from the header line (characters outside double quotes). Ties and none -> comma. */
export function detectDelimiter(text: string): DelimiterName {
  const nl = text.search(/\r|\n/);
  const line = nl === -1 ? text : text.slice(0, nl);
  const count: Record<DelimiterName, number> = { comma: 0, semicolon: 0, tab: 0 };
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (!q) for (const n of Object.keys(DELIMS) as DelimiterName[]) if (ch === DELIMS[n]) count[n]++;
  }
  let best: DelimiterName = 'comma';
  for (const n of ['semicolon', 'tab'] as const) if (count[n] > count[best]) best = n;
  return best;
}

/** Quote-aware delimited text -> rows of cells (CRLF/LF, BOM stripped, blank lines dropped). */
export function parseDelimited(input: string, delimiter: string): string[][] {
  return parseBody(input.charCodeAt(0) === 0xfeff ? input.slice(1) : input, delimiter);
}

/** parseDelimited without BOM handling (text must start at a row boundary). */
export function parseBody(text: string, delimiter: string): string[][] {
  const n = text.length;
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  while (i < n) {
    let field: string;
    if (text[i] === '"') {
      let j = i + 1, buf = '';
      for (;;) {
        const k = text.indexOf('"', j);
        if (k < 0) { buf += text.slice(j); i = n; break; }
        buf += text.slice(j, k);
        if (text[k + 1] === '"') { buf += '"'; j = k + 2; } else { i = k + 1; break; }
      }
      field = buf;
      while (i < n && text[i] !== delimiter && text[i] !== '\n' && text[i] !== '\r') i++;
    } else {
      let j = i;
      while (j < n) { const c = text[j]; if (c === delimiter || c === '\n' || c === '\r') break; j++; }
      field = text.slice(i, j); i = j;
    }
    row.push(field);
    if (i >= n) break;
    if (text[i] === delimiter) { i++; if (i >= n) row.push(''); continue; }
    if (text[i] === '\r' && text[i + 1] === '\n') i += 2; else i++;
    rows.push(row); row = [];
  }
  if (row.length) rows.push(row);
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

// ---------- column recognition (mirrors core parseWideRow) ----------

export const SCALARS: Record<string, string> = {
  tg: 'triglycerides', hdl: 'HDL cholesterol', hdl_c: 'HDL cholesterol', weight: 'weight', bmi: 'BMI', waist: 'waist',
  age: 'age', fat_mass: 'fat mass', rate_glycerol: 'glycerol Ra', rate_palmitate: 'palmitate Ra', sex: 'sex',
};
export interface ColumnInfo {
  name: string; kind: 'id' | 'variable' | 'ignored'; variable?: string;
  /** Canonical column name the parser uses (e.g. G0 for fasting_glucose); only set for series columns. */
  canonical?: string;
}


function seriesInfo(name: string, q: 'g' | 'i' | 'ffa', t: number): ColumnInfo {
  const label = q === 'g' ? 'glucose' : q === 'i' ? 'insulin' : 'FFA';
  const canonical = q === 'ffa' ? (t === 0 ? 'FFA' : `FFA${t}`) : `${q.toUpperCase()}${t}`;
  return { name, kind: 'variable', canonical, variable: t === 0 ? `fasting ${label}` : `${label} at ${t} min` };
}

export function classifyColumn(name: string): ColumnInfo {
  const lk = name.trim().toLowerCase();
  if (lk === 'participant_id' || lk === 'id') return { name, kind: 'id', variable: 'participant ID' };
  if (SCALARS[lk]) return { name, kind: 'variable', variable: SCALARS[lk] };
  const f = /^fasting_(glucose|insulin)$/.exec(lk);
  if (f) return seriesInfo(name, f[1] === 'glucose' ? 'g' : 'i', 0);
  const a = /^(glucose|insulin)_(\d+)$/.exec(lk);
  if (a) return seriesInfo(name, a[1] === 'glucose' ? 'g' : 'i', Number(a[2]));
  const m = /^(g|i|ffa)(\d*)$/.exec(lk);
  if (m) return seriesInfo(name, m[1] as 'g' | 'i' | 'ffa', m[2] === '' ? 0 : Number(m[2]));
  return { name, kind: 'ignored' };
}

/** Accepted alias spellings, for documentation and tests. */
export const ALIASES = ['fasting_glucose', 'fasting_insulin', 'glucose_<min>', 'insulin_<min>'] as const;

/** File-level errors: two columns that give the same variable. */
export function columnConflicts(columns: ColumnInfo[]): string[] {
  const seen = new Map<string, ColumnInfo>();
  const errs: string[] = [];
  for (const c of columns) {
    const key = c.canonical?.toLowerCase();
    if (!key) continue;
    const prev = seen.get(key);
    if (prev) errs.push(`Columns ${prev.name} and ${c.name} both give ${c.variable}; keep only one`);
    else seen.set(key, c);
  }
  return errs;
}


export const dataColumns = (columns: ColumnInfo[]): DataCol[] => columns.map((c, k) => ({ c, k })).filter((x) => x.c.kind === 'variable');

export interface RowProblem { row: number; id: string; messages: string[] }

export interface Loaded {
  delimiter: DelimiterName;
  header: string[];
  columns: ColumnInfo[];
  ids: string[];
  /** Parsed values in the units used in the file (not yet canonical). */
  inputs: Inputs[];
  generatedIds: boolean;
  duplicateIds: string[];
  problems: RowProblem[]; // capped for display
  /** Every row's problem messages joined by " | " (empty when none); used for the results CSV. */
  rowProblems: string[];
  rowsWithProblems: number;
  preview: string[][]; // first 20 data rows, raw cells
  total: number;
  /** File-level errors (e.g. two columns giving the same variable); calculation is blocked when non-empty. */
  fileErrors: string[];
}

const MAX_PROBLEMS_KEPT = 500;
const COMMA_DECIMAL = /^[+-]?\d+,\d+$/;

export interface RowResult { id: string; inputs: Inputs; msgs: string[] }
export type DataCol = { c: ColumnInfo; k: number };

/** One data row (cells) -> ID, parsed inputs in file units, and problem messages. n = 1-based data row number. */
export function processRow(cells: string[], n: number, idCol: number, dataCols: DataCol[]): RowResult {
  let id = idCol >= 0 ? (cells[idCol] ?? '') : '';
  const msgs: string[] = [];
  if (id === '') { id = `row_${n}`; if (idCol >= 0) msgs.push('participant ID is empty; generated ' + id); }
  const rec: Record<string, string> = {};
  for (const { c, k } of dataCols) {
    const v = cells[k] ?? '';
    if (COMMA_DECIMAL.test(v.trim()) && c.variable !== 'sex') { msgs.push(`${c.name}: use a decimal point ("${v}")`); continue; }
    rec[c.canonical ?? c.name] = v;
  }
  const w = parseWideRow(rec);
  msgs.push(...w.problems);
  return { id, inputs: w.inputs, msgs };
}

/** Text -> participants. IDs are kept exactly as text. Pure; no file access. */
export function loadTable(text: string): Loaded {
  const delimiter = detectDelimiter(text);
  const table = parseDelimited(text, DELIMS[delimiter]);
  const header = (table[0] ?? []).map((h) => h);
  const columns = header.map(classifyColumn);
  const idCol = columns.findIndex((c) => c.kind === 'id');
  const dataCols = dataColumns(columns);
  const ids: string[] = [], inputs: Inputs[] = [], problems: RowProblem[] = [], preview: string[][] = [], rowProblems: string[] = [];
  const seen = new Set<string>(), dup = new Set<string>();
  let rowsWithProblems = 0;
  for (let r = 1; r < table.length; r++) {
    const n = r; // 1-based data row number
    const pr = processRow(table[r]!, n, idCol, dataCols);
    const { id, msgs } = pr;
    if (seen.has(id)) dup.add(id); else seen.add(id);
    if (msgs.length) {
      rowsWithProblems++;
      if (problems.length < MAX_PROBLEMS_KEPT) problems.push({ row: n, id, messages: msgs });
    }
    ids.push(id); inputs.push(pr.inputs); rowProblems.push(msgs.join(' | '));
    const cells = table[r]!;
    if (preview.length < 20) preview.push(cells);
  }
  return {
    delimiter, header, columns, ids, inputs, generatedIds: idCol < 0, duplicateIds: [...dup],
    problems, rowProblems, rowsWithProblems, preview, total: ids.length, fileErrors: columnConflicts(columns),
  };
}

/** File-unit Inputs -> canonical units via core toUnit (the only conversion path). */
export function toCanonical(i: Inputs, u: UnitChoice, s: Partial<ConversionSettings>): Inputs {
  const series = (x: Series | undefined, q: 'glucose' | 'insulin' | 'ffa', from: string): Series | undefined => {
    if (!x) return undefined;
    const out: Series = {};
    for (const [t, v] of Object.entries(x)) if (typeof v === 'number') out[Number(t)] = toUnit(v, q, from as Unit, CANONICAL[q], s);
    return out;
  };
  const out: Inputs = { ...i };
  if (i.glucose) out.glucose = series(i.glucose, 'glucose', u.glucose);
  if (i.insulin) out.insulin = series(i.insulin, 'insulin', u.insulin);
  if (i.ffa) out.ffa = series(i.ffa, 'ffa', u.ffa);
  if (i.tg !== undefined) out.tg = toUnit(i.tg, 'tg', u.tg, CANONICAL.tg, s);
  if (i.hdl !== undefined) out.hdl = toUnit(i.hdl, 'hdl', u.hdl, CANONICAL.hdl, s);
  return out;
}

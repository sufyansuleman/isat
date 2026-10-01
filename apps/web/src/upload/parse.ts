import { CANONICAL, parseWideRow, toUnit, type ConversionSettings, type Inputs, type Series } from '@isat/core';
import type { UnitChoice } from '../calculate/state';

export type DelimiterName = 'comma' | 'semicolon' | 'tab';
const DELIMS: Record<DelimiterName, string> = { comma: ',', semicolon: ';', tab: '\t' };

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
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
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
export interface ColumnInfo { name: string; kind: 'id' | 'variable' | 'ignored'; variable?: string }

const SCALARS: Record<string, string> = {
  tg: 'triglycerides', hdl: 'HDL cholesterol', hdl_c: 'HDL cholesterol', weight: 'weight', bmi: 'BMI', waist: 'waist',
  age: 'age', fat_mass: 'fat mass', rate_glycerol: 'glycerol Ra', rate_palmitate: 'palmitate Ra', sex: 'sex',
};

export function classifyColumn(name: string): ColumnInfo {
  const lk = name.trim().toLowerCase();
  if (lk === 'participant_id' || lk === 'id') return { name, kind: 'id', variable: 'participant ID' };
  if (SCALARS[lk]) return { name, kind: 'variable', variable: SCALARS[lk] };
  const m = /^(g|i|ffa)(\d*)$/.exec(lk);
  if (m) {
    const q = m[1] === 'g' ? 'glucose' : m[1] === 'i' ? 'insulin' : 'FFA';
    return { name, kind: 'variable', variable: `${q} at ${m[2] === '' ? 0 : Number(m[2])} min` };
  }
  return { name, kind: 'ignored' };
}

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
}

const MAX_PROBLEMS_KEPT = 500;
const COMMA_DECIMAL = /^[+-]?\d+,\d+$/;

/** Text -> participants. IDs are kept exactly as text. Pure; no file access. */
export function loadTable(text: string): Loaded {
  const delimiter = detectDelimiter(text);
  const table = parseDelimited(text, DELIMS[delimiter]);
  const header = (table[0] ?? []).map((h) => h);
  const columns = header.map(classifyColumn);
  const idCol = columns.findIndex((c) => c.kind === 'id');
  const dataCols = columns.map((c, k) => ({ c, k })).filter((x) => x.c.kind === 'variable');
  const ids: string[] = [], inputs: Inputs[] = [], problems: RowProblem[] = [], preview: string[][] = [], rowProblems: string[] = [];
  const seen = new Set<string>(), dup = new Set<string>();
  let rowsWithProblems = 0;
  for (let r = 1; r < table.length; r++) {
    const cells = table[r]!;
    const n = r; // 1-based data row number
    let id = idCol >= 0 ? (cells[idCol] ?? '') : '';
    const msgs: string[] = [];
    if (id === '') { id = `row_${n}`; if (idCol >= 0) msgs.push('participant ID is empty; generated ' + id); }
    if (seen.has(id)) dup.add(id); else seen.add(id);
    const rec: Record<string, string> = {};
    for (const { c, k } of dataCols) {
      const v = cells[k] ?? '';
      if (COMMA_DECIMAL.test(v.trim()) && c.variable !== 'sex') { msgs.push(`${c.name}: use a decimal point ("${v}")`); continue; }
      rec[c.name] = v;
    }
    const w = parseWideRow(rec);
    msgs.push(...w.problems);
    if (msgs.length) {
      rowsWithProblems++;
      if (problems.length < MAX_PROBLEMS_KEPT) problems.push({ row: n, id, messages: msgs });
    }
    ids.push(id); inputs.push(w.inputs); rowProblems.push(msgs.join(" | "));
    if (preview.length < 20) preview.push(cells);
  }
  return {
    delimiter, header, columns, ids, inputs, generatedIds: idCol < 0, duplicateIds: [...dup],
    problems, rowProblems, rowsWithProblems, preview, total: ids.length,
  };
}

/** File-unit Inputs -> canonical units via core toUnit (the only conversion path). */
export function toCanonical(i: Inputs, u: UnitChoice, s: Partial<ConversionSettings>): Inputs {
  const series = (x: Series | undefined, q: 'glucose' | 'insulin' | 'ffa', from: string): Series | undefined => {
    if (!x) return undefined;
    const out: Series = {};
    for (const [t, v] of Object.entries(x)) if (typeof v === 'number') out[Number(t)] = toUnit(v, q, from as never, CANONICAL[q], s);
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

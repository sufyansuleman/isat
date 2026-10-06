// isat transform: adds transformed columns (log, z, RINT; optionally within sex) to a results CSV.
// Pass 1 reads the index columns into Float64Arrays, pass 2 rewrites the file with the transformed cells inserted.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  INCLUDED, RowSplitter, RowStream, splitRawRecords, transform, transformBlock, transformedCell, transformedHeaderFields,
  transformedRowFields, unquoteField, type TransformKind,
} from '@isat/core';
import { UsageError, parseArgs } from './args';
import { DataError, OutFile, PROGRESS_ROWS, checkInput, fmtN, guardOutputs, readPieces, settingsPathFor } from './files';
import type { Io } from './cli';

type Doc = Record<string, unknown>;

const KINDS: Record<string, Exclude<TransformKind, 'none'>> = { log: 'log', z: 'z', rint: 'rint' };
const KIND_NAME: Record<string, string> = { log: 'natural log', z: 'z-score (sample SD)', rint: 'rank-based inverse normal (Blom 3/8)' };

/** Calls `f` for every record of a results CSV (raw fields, quotes kept); the first record is the header. */
function forEachRecord(path: string, f: (fields: string[], n: number) => void): void {
  const sp = new RowSplitter();
  let n = 0, first = true;
  const feed = (block: string) => { if (block !== '') for (const rec of splitRawRecords(block)) f(rec, n++); };
  for (let piece of readPieces(path)) {
    if (first) { first = false; if (piece.charCodeAt(0) === 0xfeff) piece = piece.slice(1); }
    feed(sp.push(piece));
  }
  feed(sp.end());
}

/** Participant ID -> sex code (0 none, 1 male, 2 female) from the original data file; duplicate IDs are an error. */
function loadSexes(path: string): Map<string, number> {
  checkInput(path);
  const rs = new RowStream({ delimiter: 'auto' });
  const map = new Map<string, number>();
  const dup = new Set<string>();
  const take = (rows: ReturnType<RowStream['push']>) => {
    for (const r of rows) {
      if (map.has(r.id)) dup.add(r.id);
      else map.set(r.id, r.inputs.sex === 'male' ? 1 : r.inputs.sex === 'female' ? 2 : 0);
    }
  };
  for (const piece of readPieces(path)) take(rs.push(piece));
  take(rs.end());
  if (!rs.header) throw new DataError(`${path}: the file is empty (no header row)`);
  if (rs.generatedIds) throw new DataError(`${path}: no participant_id column, so rows cannot be matched to the results by ID`);
  if (!rs.columns.some((c) => c.kind === 'variable' && c.variable === 'sex')) throw new DataError(`${path}: no sex column (needed for --within-sex)`);
  if (dup.size) throw new DataError(`${path}: duplicate participant IDs (${dup.size}): ${[...dup].slice(0, 5).join(', ')}${dup.size > 5 ? ', ...' : ''}; --within-sex needs unique IDs`);
  return map;
}

/** Growable Float64Array. */
class Col {
  a: Float64Array;
  constructor(cap: number) { this.a = new Float64Array(Math.max(16, cap)).fill(NaN); }
  take(n: number): Float64Array { const o = new Float64Array(n).fill(NaN); o.set(this.a.subarray(0, Math.min(n, this.a.length))); return o; }
  set(i: number, v: number): void {
    if (i >= this.a.length) { const b = new Float64Array(this.a.length * 2).fill(NaN); b.set(this.a); this.a = b; }
    this.a[i] = v;
  }
}

export function cmdTransform(rest: string[], io: Io, commandLine: string): number {
  const p = parseArgs(rest, {
    value: ['output', 'method', 'input', 'columns'], bool: ['within-sex', 'keep-only', 'quiet', 'force', 'help'], short: { o: 'output', h: 'help' },
  });
  if (p.positional.length !== 1) throw new UsageError('transform needs exactly one results file');
  const file = p.positional[0]!;
  const output = p.values['output'];
  if (!output) throw new UsageError('transform needs -o <out.csv>');
  const m = p.values['method'];
  if (!m) throw new UsageError('transform needs --method log|z|rint');
  const kind = KINDS[m.trim().toLowerCase()];
  if (!kind) throw new UsageError(`--method: "${m}" is not valid (use log, z or rint)`);
  const withinSex = p.flags.has('within-sex');
  const sexFile = p.values['input'];
  if (withinSex && !sexFile) throw new UsageError('--within-sex needs --input <original data file> (the file the results were calculated from)');
  if (sexFile && !withinSex) throw new UsageError('--input is only used with --within-sex');
  const keepOnly = p.flags.has('keep-only');
  const quiet = p.flags.has('quiet');
  const colSpec = (p.values['columns'] ?? 'all').trim();

  checkInput(file);
  const settingsIn = settingsPathFor(file), settingsOut = settingsPathFor(output);
  guardOutputs([file, ...(sexFile ? [sexFile] : []), settingsIn], [output, settingsOut], p.flags.has('force'));
  const say = (s: string) => { if (!quiet) io.err(s); };

  let base: Doc | undefined;
  if (existsSync(settingsIn)) {
    try { base = JSON.parse(readFileSync(settingsIn, 'utf8')) as Doc; } catch { throw new DataError(`${settingsIn}: not valid JSON`); }
    if (base['chunk']) throw new DataError(`${file} is a single chunk: run isat merge first (transforms need all rows)`);
  }

  const sexMap = withinSex ? loadSexes(sexFile!) : undefined;

  // ---- pass 1: read the index columns ----
  let header: string[] | undefined;
  let idCol = -1, pos: number[] = [], names: string[] = [];
  let cols: Col[] = [];
  const sexes: Array<string | null> = [];
  const used = new Set<string>();
  const unknown: string[] = [];
  const dupIds = new Set<string>();
  let rows = 0;
  const hint = Number((base?.['row_counts'] as Doc | undefined)?.['total']);
  forEachRecord(file, (f, n) => {
    if (n === 0) {
      header = f;
      idCol = f.indexOf('participant_id');
      if (idCol < 0) throw new DataError(`${file}: no participant_id column; this is not an ISAT results file`);
      const indexNames = new Set(INCLUDED.flatMap((x) => [x.id, `${x.id}_inv`]));
      const avail = f.map((h, k) => ({ h, k })).filter((x) => indexNames.has(x.h));
      if (!avail.length) throw new DataError(`${file}: no index columns found in the header; this is not an ISAT results file`);
      const wanted = colSpec === 'all' ? avail : colSpec.split(',').map((s) => s.trim()).filter((s) => s !== '').map((s) => avail.find((x) => x.h === s) ?? s);
      const bad = wanted.filter((x): x is string => typeof x === 'string');
      if (bad.length) throw new UsageError(`--columns: not index columns in ${file}: ${bad.join(', ')} (available: ${avail.map((x) => x.h).join(', ')})`);
      const sel = (wanted as Array<{ h: string; k: number }>).sort((a, b) => a.k - b.k);
      pos = sel.map((x) => x.k); names = sel.map((x) => x.h);
      if (!names.length) throw new UsageError('--columns: no columns selected');
      cols = names.map(() => new Col(Number.isFinite(hint) && hint > 0 ? hint : 1024));
      return;
    }
    if (f.length !== header!.length) throw new DataError(`${file}: row ${n} has ${f.length} fields, the header has ${header!.length}`);
    for (let j = 0; j < pos.length; j++) { const c = f[pos[j]!]!; if (c !== '') cols[j]!.set(rows, Number(c)); }
    if (sexMap) {
      const id = unquoteField(f[idCol]!);
      const code = sexMap.get(id);
      if (code === undefined) { if (unknown.length < 5) unknown.push(id); else if (unknown.length === 5) unknown.push('...'); sexes.push(null); }
      else if (code >= 4) { dupIds.add(id); sexes.push(null); }
      else { sexMap.set(id, code | 4); sexes.push(code === 1 ? 'male' : code === 2 ? 'female' : null); }
    }
    rows++;
    if (rows % PROGRESS_ROWS === 0) say(`pass 1: ${fmtN(rows)} rows\n`);
  });
  if (!header) throw new DataError(`${file}: the file is empty`);
  if (dupIds.size) throw new DataError(`${file}: duplicate participant IDs (${dupIds.size}): ${[...dupIds].slice(0, 5).join(', ')}${dupIds.size > 5 ? ', ...' : ''}; --within-sex needs unique IDs`);
  if (unknown.length) throw new DataError(`${file}: participant IDs not found in ${sexFile}: ${unknown.join(', ')}`);

  // ---- transform (column by column; the raw values are replaced as we go) ----
  const suffix = `_${kind}${withinSex ? '_bysex' : ''}`;
  const tvals: Float64Array[] = [];
  const nonPositive: Record<string, number> = {};
  const groupN: Record<string, Record<string, number>> = {};
  const reasons: string[] = [];
  for (let j = 0; j < names.length; j++) {
    const raw = cols[j]!.take(rows);
    const r = transform(raw, kind, withinSex ? { groups: sexes } : {});
    tvals.push(r.values);
    cols[j] = new Col(0); // free the raw column
    if (kind === 'log') nonPositive[names[j]!] = r.nonPositive;
    if (withinSex) { groupN[names[j]!] = r.groupN; }
    for (const why of r.reasons) reasons.push(`${names[j]}: ${why}`);
  }
  cols = [];
  const missingSex = sexes.reduce((s, x) => s + (x === null ? 1 : 0), 0);

  // ---- pass 2: write ----
  const out = new OutFile(output);
  let written = 0;
  try {
    const tv = new Float64Array(pos.length);
    forEachRecord(file, (f, n) => {
      if (n === 0) {
        const h = keepOnly ? [f[idCol]!, ...pos.map((k) => f[k]! + suffix)] : transformedHeaderFields(f, pos, suffix);
        out.write(h.join(',') + '\r\n');
        return;
      }
      const r = n - 1;
      if (r >= rows) throw new DataError(`${file}: the file changed while reading`);
      for (let j = 0; j < pos.length; j++) tv[j] = tvals[j]![r]!;
      const line = keepOnly ? [f[idCol]!, ...Array.from(tv, transformedCell)] : transformedRowFields(f, pos, tv);
      out.write(line.join(',') + '\r\n');
      written++;
      if (written % PROGRESS_ROWS === 0) say(`pass 2: ${fmtN(written)} rows\n`);
    });
    if (written !== rows) throw new DataError(`${file}: the file changed while reading`);
    out.commit();
  } catch (e) { out.abort(); throw e; }

  // ---- settings ----
  const block: Doc = {
    ...transformBlock({ kind, withinSex, addedColumns: true, suffix }),
    keep_only: keepOnly,
    columns: names,
    ...(kind === 'log' ? { non_positive_set_to_missing: nonPositive } : {}),
    ...(withinSex ? { group_n: groupN, rows_without_recognised_sex: missingSex, sex_source: basename(sexFile!) } : {}),
    ...(reasons.length ? { not_transformed: reasons } : {}),
  };
  const doc: Doc = {
    ...(base ?? { row_counts: { total: rows } }),
    timestamp: new Date().toISOString(),
    interface: 'cli',
    command: commandLine,
    transform: block,
    transformed_from: basename(file),
  };
  writeFileSync(settingsOut, JSON.stringify(doc, null, 2));

  if (!quiet) {
    io.out(`Wrote ${fmtN(written)} rows to ${output} (${names.length} column${names.length === 1 ? '' : 's'}: ${KIND_NAME[kind]}${withinSex ? ', within sex' : ''}${keepOnly ? ', transformed columns only' : ''})\n`);
    if (kind === 'log') { const t = Object.values(nonPositive).reduce((s, x) => s + x, 0); if (t) io.out(`Values <= 0 set to missing: ${fmtN(t)}\n`); }
    if (withinSex) io.out(`Rows without a recognised sex (transformed value missing): ${fmtN(missingSex)}\n`);
    for (const w of reasons) io.out(`Not transformed: ${w}\n`);
    io.out(`Settings: ${settingsOut}\n`);
  }
  return 0;
}

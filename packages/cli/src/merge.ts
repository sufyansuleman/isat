// isat merge: joins the chunk outputs of `isat calculate --chunk i/n` into one results file (streaming, byte copy).
import { closeSync, existsSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { UsageError, parseArgs } from './args';
import { DataError, OutFile, READ_BYTES, checkInput, fmtN, guardOutputs, settingsPathFor } from './files';
import type { Io } from './cli';

type Doc = Record<string, unknown>;
interface ChunkInfo { index: number; of: number; first_row: number; last_row: number; total_rows: number }
interface Part { file: string; doc: Doc; chunk: ChunkInfo; header: Buffer }

const sortKeys = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortKeys)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Doc).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, sortKeys(x)]))
      : v;
const canon = (v: unknown): string => JSON.stringify(sortKeys(v)) ?? 'undefined';

/** Settings fields that must be identical in every chunk. */
const MUST_MATCH: Array<[string, (d: Doc) => unknown]> = [
  ['ISAT version', (d) => d['isat_version']],
  ['units', (d) => d['units']],
  ['conversion factors', (d) => d['conversion_factors']],
  ['orientation', (d) => d['orientation']],
  ['Avignon weight', (d) => d['avignon_weight']],
  ['status-columns setting', (d) => d['include_status_columns']],
  ['delimiter', (d) => d['delimiter']],
  ['input file fingerprint (size, rows, header)', (d) => d['input_fingerprint']],
  ['number of chunks (n)', (d) => (d['chunk'] as ChunkInfo | undefined)?.of],
];

/** First line of a file (without line ending), as bytes. */
function readHeader(file: string): Buffer {
  const fd = openSync(file, 'r');
  try {
    const parts: Buffer[] = [];
    const buf = Buffer.alloc(64 * 1024);
    for (let pos = 0; ; ) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n === 0) break;
      const nl = buf.subarray(0, n).indexOf(10);
      if (nl >= 0) { parts.push(Buffer.from(buf.subarray(0, nl))); break; }
      parts.push(Buffer.from(buf.subarray(0, n))); pos += n;
    }
    const h = Buffer.concat(parts);
    return h.length && h[h.length - 1] === 13 ? h.subarray(0, h.length - 1) : h;
  } finally { closeSync(fd); }
}

function loadPart(file: string): Part {
  checkInput(file);
  const sp = settingsPathFor(file);
  if (!existsSync(sp)) throw new DataError(`${file}: settings file ${sp} not found (merge needs the settings written by isat calculate --chunk)`);
  let doc: Doc;
  try { doc = JSON.parse(readFileSync(sp, 'utf8')) as Doc; } catch { throw new DataError(`${sp}: not valid JSON`); }
  const c = doc['chunk'] as ChunkInfo | undefined;
  if (!c || !Number.isInteger(c.index) || !Number.isInteger(c.of)) throw new DataError(`${file}: settings have no chunk information (was it made with --chunk?)`);
  const header = readHeader(file);
  if (header.length === 0) throw new DataError(`${file}: the file is empty (no header row)`);
  return { file, doc, chunk: c, header };
}

/** Copies a chunk file (minus its header unless first) and counts its data records (quote-aware). */
function copyChunk(part: Part, out: OutFile, withHeader: boolean, isLast: boolean): number {
  const fd = openSync(part.file, 'r');
  try {
    const buf = Buffer.alloc(READ_BYTES);
    let inHeader = true, inQ = false, has = false, rows = 0;
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      let start = 0;
      if (inHeader) {
        const nl = buf.subarray(0, n).indexOf(10);
        if (nl < 0) { if (withHeader) out.writeBytes(buf.subarray(0, n)); continue; }
        if (withHeader) out.writeBytes(buf.subarray(0, nl + 1));
        inHeader = false; start = nl + 1;
      }
      for (let i = start; i < n; i++) {
        const c = buf[i]!;
        if (c === 34) { inQ = !inQ; has = true; }
        else if (c === 10 && !inQ) { if (has) rows++; has = false; }
        else if (c !== 13 || inQ) has = true;
      }
      if (n > start) out.writeBytes(buf.subarray(start, n));
    }
    if (inHeader && withHeader) out.writeBytes(Buffer.from('\r\n')); // header-only file without line ending
    if (has) {
      rows++;
      if (!isLast) throw new DataError(`${part.file}: does not end with a line break`);
    }
    return rows;
  } finally { closeSync(fd); }
}

export function cmdMerge(rest: string[], io: Io, commandLine: string): number {
  const p = parseArgs(rest, { value: ['output'], bool: ['quiet', 'force', 'help'], short: { o: 'output', h: 'help' } });
  if (p.positional.length < 1) throw new UsageError('merge needs the chunk files (e.g. isat merge res_*.csv -o results.csv)');
  const output = p.values['output'];
  if (!output) throw new UsageError('merge needs -o <out.csv>');
  const quiet = p.flags.has('quiet');

  const parts = p.positional.map(loadPart);
  const problems: string[] = [];

  // Same ISAT version, units, factors, orientation, Avignon weight, status flag, input and n in every chunk.
  const ref = parts[0]!;
  for (const [label, get] of MUST_MATCH) {
    const want = canon(get(ref.doc));
    for (const q of parts.slice(1)) if (canon(get(q.doc)) !== want) problems.push(`${basename(q.file)} differs from ${basename(ref.file)} in ${label}`);
  }
  if (problems.length) throw new DataError(`the chunks are not from the same run:\n  ${problems.join('\n  ')}`);

  // Exactly chunks 1..n, each once.
  const n = ref.chunk.of;
  const byIndex = new Map<number, Part[]>();
  for (const q of parts) {
    if (q.chunk.index < 1 || q.chunk.index > n) problems.push(`${basename(q.file)}: chunk index ${q.chunk.index} is outside 1..${n}`);
    byIndex.set(q.chunk.index, [...(byIndex.get(q.chunk.index) ?? []), q]);
  }
  for (const [k, ps] of byIndex) if (ps.length > 1) problems.push(`chunk ${k}/${n} given more than once: ${ps.map((x) => basename(x.file)).join(', ')}`);
  const missing: number[] = [];
  for (let k = 1; k <= n; k++) if (!byIndex.has(k)) missing.push(k);
  if (missing.length) problems.push(`missing chunk${missing.length > 1 ? 's' : ''} ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ', ...' : ''} of ${n}`);
  if (problems.length) throw new DataError(problems.join('\n  '));

  const ordered = [...parts].sort((a, b) => a.chunk.index - b.chunk.index);
  const hdr0 = ordered[0]!.header;
  for (const q of ordered) if (!q.header.equals(hdr0)) problems.push(`${basename(q.file)}: CSV header differs from chunk 1`);
  // Rows must be contiguous and cover the input.
  let expectFirst = 1;
  for (const q of ordered) {
    if (q.chunk.first_row !== expectFirst) problems.push(`${basename(q.file)}: chunk ${q.chunk.index} starts at row ${q.chunk.first_row}, expected ${expectFirst}`);
    expectFirst = q.chunk.last_row + 1;
  }
  if (expectFirst - 1 !== ref.chunk.total_rows) problems.push(`chunks cover ${expectFirst - 1} rows but the input has ${ref.chunk.total_rows}`);
  if (problems.length) throw new DataError(problems.join('\n  '));

  const settingsOut = settingsPathFor(output);
  guardOutputs([...parts.map((q) => q.file), ...parts.map((q) => settingsPathFor(q.file))], [output, settingsOut], p.flags.has('force'));

  const out = new OutFile(output);
  try {
    ordered.forEach((q, k) => {
      const rows = copyChunk(q, out, k === 0, k === ordered.length - 1);
      const want = q.chunk.last_row - q.chunk.first_row + 1;
      if (rows !== want) throw new DataError(`${q.file}: has ${fmtN(rows)} data rows, its settings say ${fmtN(want)}`);
    });
    out.commit();
  } catch (e) { out.abort(); throw e; }

  const sum = (key: string): number => ordered.reduce((s, q) => s + Number((q.doc['row_counts'] as Doc | undefined)?.[key] ?? 0), 0);
  const base: Doc = { ...ref.doc };
  delete base['chunk'];
  const merged: Doc = {
    ...base,
    timestamp: new Date().toISOString(),
    interface: 'cli',
    command: commandLine,
    unit_check: [],
    unit_check_note: 'Unit plausibility checks were made per chunk (see the chunk settings files); run isat check on the input file for a whole-file check.',
    row_counts: { total: sum('total'), with_problems: sum('with_problems'), rows_with_input_problems: sum('rows_with_input_problems'), calculated: sum('calculated') },
    merged_from: ordered.map((q) => basename(q.file)),
  };
  writeFileSync(settingsOut, JSON.stringify(merged, null, 2));
  if (!quiet) {
    io.out(`Merged ${ordered.length} chunks (${fmtN(sum('total'))} rows) into ${output}\n`);
    io.out(`Settings: ${settingsOut}\n`);
  }
  return 0;
}

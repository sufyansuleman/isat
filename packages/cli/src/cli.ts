// ISAT command-line tool. Node built-ins only (so `deno compile` can build it). run() is exported for in-process tests.
import { closeSync, existsSync, openSync, renameSync, statSync, unlinkSync, writeSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import process from 'node:process';
import {
  AVIGNON_1999_WEIGHT, AvignonAccumulator, RowSplitter, countRecords, DEFAULT_SETTINGS, DEFAULT_UNIT_CHOICE, INCLUDED, ResultsStream, RowStream, UnitCheckCollector,
  methodSpecs, settingsFile, toCanonical, warningText,
  type AvignonUse, type ConversionSettings, type DelimiterName, type StreamRow, type UnitChoice,
} from '@isat/core';
import { UsageError, parseArgs } from './args';
import { DataError, PROGRESS_ROWS, WRITE_BYTES, checkInput, fmtN, readPieces, settingsPathFor } from './files';
export { settingsPathFor } from './files';
import { ISAT_VERSION } from './version';
import { cmdMerge } from './merge';
import { cmdTransform } from './transform';

export interface Io { out(s: string): void; err(s: string): void }

export function nodeIo(): Io {
  return { out: (s) => { process.stdout.write(s); }, err: (s) => { process.stderr.write(s); } };
}

const SLICE_ROWS = 5000;
const MAX_LISTED_PROBLEMS = 20;

// ---------- help ----------
const USAGE = `ISAT command-line tool

Usage: isat <command> [options]

Commands:
  calculate <file> -o <out.csv>   Calculate all included indices for a CSV/TSV file
  merge <chunks...> -o <out.csv>  Join the outputs of calculate --chunk into one results file
  transform <results.csv> -o <out.csv> --method log|z|rint
                                  Add log / z-score / RINT columns to a results file
  check <file>                    Check a file (columns, problems, units) without calculating
  methods [--json]                List the included methods
  version                         Show the ISAT version and default conversion factors

Run "isat <command> --help" for details.

Examples:
  isat check cohort.csv --glucose-unit mg/dL
  isat calculate cohort.csv -o results.csv

On a SLURM cluster (split the rows into 20 chunks, then join them):
  #SBATCH --array=1-20
  isat calculate data.csv -o res_\${SLURM_ARRAY_TASK_ID}.csv --chunk \${SLURM_ARRAY_TASK_ID}/20 --avignon-weight 0.137
  then: isat merge res_*.csv -o results.csv
`;

const UNIT_HELP = `Unit options (default: the units of the web app's template):
  --glucose-unit mmol/L|mg/dL        default mmol/L
  --insulin-unit pmol/L|uU/mL        default pmol/L (also accepts µU/mL, mU/L)
  --tg-unit mmol/L|mg/dL             default mmol/L
  --hdl-unit mmol/L|mg/dL            default mmol/L
  --ffa-unit mmol/L|umol/L           default mmol/L
  --insulin-factor 6.0|6.945         pmol/L per µU/mL, default 6.0
  --glucose-factor 18|18.016         mg/dL per mmol/L, default 18
  --delimiter auto|comma|semicolon|tab   default auto`;

const HELP: Record<string, string> = {
  calculate: `Usage: isat calculate <file> -o <out.csv> [options]

Streams the input file and the output file (constant memory; no row limit).
Also writes <out>.settings.json (e.g. results.csv -> results.settings.json) (units, factors, Avignon weight, counts).

${UNIT_HELP}

Other options:
  -o, --output <out.csv>             output file (required)
  --orientation published|inv        published (default) or sensitivity orientation (_inv columns)
  --avignon-weight published|sample|<number>
                                     published = 0.137 (Avignon 1999, default); sample = derived from
                                     this file (reads it twice); or a number
  --status-columns                   add a <index>_status column per index
  --chunk <i>/<n>                    process only block i of n (1-based) of the data rows, for job arrays;
                                     join the outputs with "isat merge". With --chunk, --avignon-weight
                                     sample is not available (run "isat check <file>", pass the number)
  --quiet                            no progress or summary output
  --force                            overwrite existing output files
  -h, --help                         this text

Examples:
  isat calculate cohort.csv -o results.csv
  isat calculate cohort.csv -o results.csv --glucose-unit mg/dL --insulin-unit uU/mL --status-columns
  isat calculate cohort.csv -o results.csv --avignon-weight sample --orientation inv

SLURM job array (20 chunks, then merge):
  #SBATCH --array=1-20
  isat calculate data.csv -o res_\${SLURM_ARRAY_TASK_ID}.csv --chunk \${SLURM_ARRAY_TASK_ID}/20 --avignon-weight 0.137
  then: isat merge res_*.csv -o results.csv
`,
  merge: `Usage: isat merge <chunk files...> -o <out.csv> [options]

Joins the outputs of "isat calculate --chunk i/n" (i = 1..n) into one results file, byte for byte what an
unchunked run gives. Each chunk's settings file (res_3.csv -> res_3.settings.json) is read and checked:
same ISAT version, units, factors, orientation, Avignon weight, status-columns setting, input file
(size, rows, header) and n; exactly chunks 1..n once each; same CSV header; row counts as recorded.
The order of the arguments does not matter. Any inconsistency stops the merge (exit code 2).
Writes <out>.settings.json (chunk information removed, row counts summed, merged_from listed).

Options:
  -o, --output <out.csv>             merged file (required)
  --quiet                            no summary output
  --force                            overwrite existing output files
  -h, --help                         this text

SLURM example:
  #SBATCH --array=1-20
  isat calculate data.csv -o res_\${SLURM_ARRAY_TASK_ID}.csv --chunk \${SLURM_ARRAY_TASK_ID}/20 --avignon-weight 0.137
  then: isat merge res_*.csv -o results.csv
`,
  transform: `Usage: isat transform <results.csv> -o <out.csv> --method log|z|rint [options]

Adds transformed columns to a results file made by calculate or merge. Each index column <col> gets
<col>_<log|z|rint>[_bysex] directly after it (same layout and numbers as the web app's "Add transformed
columns"). Missing values stay missing. Settings are carried forward from <results>.settings.json and
the transform is recorded in <out>.settings.json.

  log    natural log; values <= 0 are set to missing and counted
  z      (x - mean) / SD with the sample SD (n - 1)
  rint   rank-based inverse normal, Blom offset 3/8

Options:
  -o, --output <out.csv>             output file (required)
  --method log|z|rint                transform (required)
  --within-sex                       transform separately in men and women; needs --input
  --input <original data file>       the file the results came from (for sex; IDs must be unique and match)
  --columns all|a,b,c                index columns to transform (default all; names as in the results header)
  --keep-only                        write participant_id and the transformed columns only
  --quiet                            no progress or summary output
  --force                            overwrite existing output files
  -h, --help                         this text

Rows with a missing or unrecognised sex get a missing value in the transformed columns.
The whole file must be given (not a single chunk): merge chunks first.

Example:
  isat transform results.csv -o results_rint.csv --method rint --within-sex --input cohort.csv
`,
  check: `Usage: isat check <file> [options]

Reads the file (streaming) and reports rows, delimiter, recognised and unrecognised columns, alias
conflicts, rows with problems (first ${MAX_LISTED_PROBLEMS}), unit plausibility warnings and the
cohort-derived Avignon weight. Exit code 0 unless the file has a fatal error (then 2).

${UNIT_HELP}

Example:
  isat check cohort.csv --glucose-unit mg/dL
`,
  methods: `Usage: isat methods [--json]

Lists the included methods (id, name, category, direction, verification level, primary reference).
--json prints the same as JSON.
`,
  version: `Usage: isat version

Shows the ISAT version and the default conversion factors.
`,
};

// ---------- options ----------
const UNIT_VALUES = ['glucose-unit', 'insulin-unit', 'tg-unit', 'hdl-unit', 'ffa-unit', 'insulin-factor', 'glucose-factor', 'delimiter'];

const oneOf = <T extends string>(opt: string, v: string, table: Record<string, T>): T => {
  const hit = table[v.trim().toLowerCase()];
  if (!hit) throw new UsageError(`--${opt}: "${v}" is not valid (use ${[...new Set(Object.values(table))].join(' or ')})`);
  return hit;
};

interface Common { units: UnitChoice; settings: Partial<ConversionSettings>; factors: { insulin: string; glucose: string }; delimiter: DelimiterName | 'auto' }

function commonOptions(v: Record<string, string>): Common {
  const mass = { 'mmol/l': 'mmol/L', 'mg/dl': 'mg/dL' } as const;
  const units: UnitChoice = {
    glucose: v['glucose-unit'] ? oneOf('glucose-unit', v['glucose-unit'], mass) : DEFAULT_UNIT_CHOICE.glucose,
    insulin: v['insulin-unit']
      ? oneOf('insulin-unit', v['insulin-unit'], { 'pmol/l': 'pmol/L', 'uu/ml': 'uU/mL', 'µu/ml': 'uU/mL', 'μu/ml': 'uU/mL', 'mu/l': 'uU/mL' })
      : DEFAULT_UNIT_CHOICE.insulin,
    tg: v['tg-unit'] ? oneOf('tg-unit', v['tg-unit'], mass) : DEFAULT_UNIT_CHOICE.tg,
    hdl: v['hdl-unit'] ? oneOf('hdl-unit', v['hdl-unit'], mass) : DEFAULT_UNIT_CHOICE.hdl,
    ffa: v['ffa-unit']
      ? oneOf('ffa-unit', v['ffa-unit'], { 'mmol/l': 'mmol/L', 'umol/l': 'umol/L', 'µmol/l': 'umol/L', 'μmol/l': 'umol/L' })
      : DEFAULT_UNIT_CHOICE.ffa,
  };
  const factor = (opt: string, allowed: string[]): string => {
    const raw = v[opt];
    if (raw === undefined) return allowed[0]!;
    const hit = allowed.find((a) => Number(a) === Number(raw) && raw.trim() !== '');
    if (!hit) throw new UsageError(`--${opt}: "${raw}" is not offered (use ${allowed.join(' or ')})`);
    return hit;
  };
  const insulin = factor('insulin-factor', ['6', '6.945']);
  const glucose = factor('glucose-factor', ['18', '18.016']);
  const delimiter = v['delimiter'] ? oneOf('delimiter', v['delimiter'], { auto: 'auto', comma: 'comma', semicolon: 'semicolon', tab: 'tab' } as Record<string, DelimiterName | 'auto'>) : 'auto';
  return {
    units, factors: { insulin, glucose }, delimiter,
    settings: { glucose_mg_per_dL_per_mmol: Number(glucose), insulin_pmol_per_uU: Number(insulin) },
  };
}

/** Feeds a file through a RowStream, calling onRows for each batch of parsed rows. */
function streamFile(path: string, rs: RowStream, onRows: (rows: StreamRow[]) => void, stop?: () => boolean): void {
  for (const piece of readPieces(path)) {
    const rows = rs.push(piece);
    if (rows.length || rs.header) onRows(rows);
    if (stop?.()) return;
  }
  onRows(rs.end());
}

/** Data rows in a file (non-blank records after the header; quoted newlines handled by RowSplitter). */
function countDataRows(path: string): number {
  const sp = new RowSplitter();
  let records = 0, first = true;
  for (let piece of readPieces(path)) {
    if (first) { first = false; if (piece.charCodeAt(0) === 0xfeff) piece = piece.slice(1); }
    const block = sp.push(piece);
    if (block !== '') records += countRecords(block);
  }
  records += countRecords(sp.end());
  return Math.max(0, records - 1);
}

/** 1-based "i/n" -> {index, of}. */
function parseChunk(v: string): { index: number; of: number } {
  const m = /^(\d+)\/(\d+)$/.exec(v.trim());
  const bad = () => new UsageError(`--chunk: "${v}" is not valid (use i/n with 1 <= i <= n, e.g. 3/20)`);
  if (!m) throw bad();
  const index = Number(m[1]), of = Number(m[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(of) || of < 1 || index < 1 || index > of) throw bad();
  return { index, of };
}

/** Contiguous block of data rows for chunk i of n: 0-based [floor((i-1)N/n), floor(iN/n)); returned first/last are 1-based inclusive (last < first = empty). */
export function chunkRange(index: number, of: number, total: number): { first: number; last: number } {
  return { first: Math.floor(((index - 1) * total) / of) + 1, last: Math.floor((index * total) / of) };
}

function requireHeader(rs: RowStream, path: string): void {
  if (!rs.header) throw new DataError(`${path}: the file is empty (no header row)`);
  if (rs.fileErrors.length) throw new DataError(`${path}: ${rs.fileErrors.join('; ')}`);
  if (!rs.columns.some((c) => c.kind === 'variable')) throw new DataError(`${path}: no recognised data columns in the header`);
}

// ---------- commands ----------
function cmdVersion(io: Io): number {
  const d = DEFAULT_SETTINGS;
  io.out(`ISAT ${ISAT_VERSION}\n`);
  io.out('Default conversion factors:\n');
  io.out(`  glucose: ${d.glucose_mg_per_dL_per_mmol} mg/dL per mmol/L\n`);
  io.out(`  insulin: ${d.insulin_pmol_per_uU} pmol/L per uU/mL\n`);
  io.out(`  TG: ${d.tg_mg_per_dL_per_mmol} mg/dL per mmol/L\n`);
  io.out(`  HDL: ${d.hdl_mg_per_dL_per_mmol} mg/dL per mmol/L\n`);
  return 0;
}

interface Cite { citation?: string }
type Spec = Record<string, unknown> & { reference?: Cite; source?: unknown; methods?: Array<Record<string, unknown>> };

/** "Gastaldelli et al. 2017" from a full citation. */
export function shortRef(citation: string | undefined): string {
  if (!citation) return '';
  const authors = citation.split('. ')[0] ?? citation;
  const first = (authors.split(/[ ,]/)[0] ?? '').trim();
  const year = /\b(?:19|20)\d{2}\b/.exec(citation.slice(authors.length))?.[0] ?? '';
  return `${first}${authors.includes(',') ? ' et al.' : ''} ${year}`.trim();
}

function primaryCitation(id: string): string | undefined {
  for (const s of Object.values(methodSpecs) as unknown as Spec[]) {
    const m = Array.isArray(s.methods) ? s.methods.find((x) => x['id'] === id) : s['id'] === id ? s : undefined;
    if (!m) continue;
    const pick = (x: Record<string, unknown>) => (x['reference'] as Cite | undefined)?.citation ?? (typeof x['source'] === 'object' ? (x['source'] as Cite).citation : undefined);
    return pick(m) ?? pick(s);
  }
  return undefined;
}

function cmdMethods(rest: string[], io: Io): number {
  const p = parseArgs(rest, { value: [], bool: ['json', 'help'], short: { h: 'help' } });
  if (p.positional.length) throw new UsageError('methods takes no arguments');
  const rows = INCLUDED.map((m) => ({
    id: m.id, name: m.name, category: m.category, direction: m.direction,
    verification: m.source_verification, reference: shortRef(primaryCitation(m.id)),
  }));
  if (p.flags.has('json')) { io.out(JSON.stringify(rows, null, 2) + '\n'); return 0; }
  const head = ['id', 'name', 'category', 'direction', 'verification', 'reference'] as const;
  const w = head.map((h) => Math.max(h.length, ...rows.map((r) => r[h].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(w[i]!)).join('  ').trimEnd() + '\n';
  io.out(line([...head]));
  for (const r of rows) io.out(line(head.map((h) => r[h])));
  return 0;
}

function cmdCheck(rest: string[], io: Io): number {
  const p = parseArgs(rest, { value: UNIT_VALUES, bool: ['help'], short: { h: 'help' } });
  if (p.positional.length !== 1) throw new UsageError('check needs exactly one file');
  const file = p.positional[0]!;
  const c = commonOptions(p.values);
  checkInput(file);

  const rs = new RowStream({ delimiter: c.delimiter });
  const uc = new UnitCheckCollector();
  const acc = new AvignonAccumulator(c.settings);
  const listed: StreamRow[] = [];
  const seen = new Set<string>(), dup = new Set<string>();
  let withProblems = 0;
  streamFile(file, rs, (rows) => {
    for (const r of rows) {
      uc.add(r.inputs);
      if (seen.has(r.id)) dup.add(r.id); else seen.add(r.id);
      if (r.msgs.length) { withProblems++; if (listed.length < MAX_LISTED_PROBLEMS) listed.push(r); }
    }
    acc.add(rows.map((r) => toCanonical(r.inputs, c.units, c.settings)));
  });
  if (!rs.header) throw new DataError(`${file}: the file is empty (no header row)`);

  io.out(`File: ${file}\n`);
  io.out(`Rows: ${fmtN(rs.rows)}\n`);
  io.out(`Delimiter: ${rs.delimiter ?? 'comma'}\n`);
  const rec = rs.columns.filter((x) => x.kind !== 'ignored');
  const ign = rs.columns.filter((x) => x.kind === 'ignored');
  io.out(`Recognised columns (${rec.length}): ${rec.map((x) => (x.canonical && x.canonical !== x.name ? `${x.name} (as ${x.canonical})` : x.name)).join(', ') || 'none'}\n`);
  io.out(`Unrecognised columns, ignored (${ign.length}): ${ign.map((x) => x.name).join(', ') || 'none'}\n`);
  if (rs.generatedIds) io.out('No participant_id column: IDs are generated (row_1, row_2, ...)\n');
  if (dup.size) io.out(`Duplicate participant IDs (${dup.size}): ${[...dup].slice(0, 5).join(', ')}${dup.size > 5 ? ', ...' : ''}\n`);
  if (rs.fileErrors.length) { io.out('Column conflicts:\n'); for (const e of rs.fileErrors) io.out(`  ${e}\n`); }
  io.out(`Rows with problems: ${fmtN(withProblems)}\n`);
  for (const r of listed) io.out(`  row ${r.n} (${r.id}): ${r.msgs.join(' | ')}\n`);
  if (withProblems > listed.length) io.out(`  ... and ${fmtN(withProblems - listed.length)} more\n`);

  const warns = uc.finish(c.units).filter((i) => i.suggested !== null);
  if (warns.length) for (const w of warns) io.out(`${warningText(w)}\n`);
  else io.out('Unit check: no warnings\n');

  const av = acc.result();
  io.out(av.source === 'sample'
    ? `Avignon SiM weight derived from this cohort: ${av.w} (${acc.pairs} rows with Si0 and Si120; published weight ${AVIGNON_1999_WEIGHT})\n`
    : `Avignon SiM weight derived from this cohort: not available (fewer than 2 rows have both Si0 and Si120; published weight ${AVIGNON_1999_WEIGHT} would be used)\n`);

  if (!rs.columns.some((x) => x.kind === 'variable')) throw new DataError(`${file}: no recognised data columns in the header`);
  if (rs.fileErrors.length) { io.err(`error: ${file}: ${rs.fileErrors.length} column conflict(s); calculation is blocked\n`); return 2; }
  return 0;
}

function cmdCalculate(rest: string[], io: Io, commandLine: string): number {
  const p = parseArgs(rest, {
    value: [...UNIT_VALUES, 'output', 'orientation', 'avignon-weight', 'chunk'],
    bool: ['status-columns', 'quiet', 'force', 'help'], short: { o: 'output', h: 'help' },
  });
  if (p.positional.length !== 1) throw new UsageError('calculate needs exactly one input file');
  const input = p.positional[0]!;
  const output = p.values['output'];
  if (!output) throw new UsageError('calculate needs -o <out.csv>');
  const c = commonOptions(p.values);
  const orientation = p.values['orientation'] === undefined ? 'published' : oneOf('orientation', p.values['orientation'], { published: 'published', inv: 'sensitivity' } as const);
  const includeStatus = p.flags.has('status-columns');
  const quiet = p.flags.has('quiet');
  const aw = p.values['avignon-weight'] ?? 'published';
  const chunk = p.values['chunk'] === undefined ? undefined : parseChunk(p.values['chunk']);
  if (chunk && aw === 'sample') throw new UsageError('Cohort Avignon weight needs the whole file: run `isat check <file>` to get it, then pass --avignon-weight <number>.');
  let fixedAv: AvignonUse | undefined;
  if (aw === 'published') fixedAv = { w: AVIGNON_1999_WEIGHT, source: 'avignon_1999', warnings: [] };
  else if (aw !== 'sample') {
    const x = Number(aw);
    if (aw.trim() === '' || !Number.isFinite(x) || x <= 0) throw new UsageError(`--avignon-weight: "${aw}" is not valid (use published, sample or a positive number)`);
    fixedAv = { w: x, source: 'user', warnings: [] };
  }

  checkInput(input);
  const settingsPath = settingsPathFor(output);
  if (resolve(output) === resolve(input)) throw new DataError('the output file is the input file');
  for (const f of [output, settingsPath]) {
    if (existsSync(f) && !p.flags.has('force')) throw new DataError(`${f} already exists (use --force to overwrite)`);
  }
  const say = (s: string) => { if (!quiet) io.err(s); };

  // Chunk mode: count the data rows first (cheap pass), then keep only this block.
  let range: { first: number; last: number } | undefined;
  let totalRows = 0;
  if (chunk) {
    totalRows = countDataRows(input);
    range = chunkRange(chunk.index, chunk.of, totalRows);
    say(`chunk ${chunk.index}/${chunk.of}: rows ${fmtN(range.first)}-${fmtN(range.last)} of ${fmtN(totalRows)}\n`);
  }

  // Pass 1 (only for the sample-derived Avignon weight).
  let av = fixedAv;
  if (!av) {
    const acc = new AvignonAccumulator(c.settings);
    const rs1 = new RowStream({ delimiter: c.delimiter });
    let done = 0, next = PROGRESS_ROWS;
    streamFile(input, rs1, (rows) => {
      if (!rows.length) return;
      acc.add(rows.map((r) => toCanonical(r.inputs, c.units, c.settings)));
      done += rows.length;
      while (done >= next) { say(`pass 1 (Avignon weight): ${fmtN(next)} rows\n`); next += PROGRESS_ROWS; }
    });
    requireHeader(rs1, input);
    av = acc.result();
    say(`Avignon weight derived from the file: ${av.w}\n`);
  }

  // Main pass: parse, calculate, write.
  const tmp = output + '.partial';
  let fd: number | undefined;
  const rs = new RowStream({ delimiter: c.delimiter });
  const uc = new UnitCheckCollector();
  const results = new ResultsStream({ units: c.units, settings: c.settings, av, orientation, includeStatus });
  let pending = '', next = PROGRESS_ROWS;
  const flush = (force = false) => {
    if (fd === undefined || pending === '' || (!force && pending.length < WRITE_BYTES)) return;
    writeSync(fd, pending); pending = '';
  };
  try {
    streamFile(input, rs, (rows) => {
      if (range) rows = rows.filter((r) => r.n >= range!.first && r.n <= range!.last);
      if (fd === undefined) {
        if (!rs.header) return;
        requireHeader(rs, input);
        try { fd = openSync(tmp, 'w'); } catch (e) { throw new DataError(`cannot write ${tmp}: ${(e as NodeJS.ErrnoException).code ?? String(e)}`); }
        pending = results.header();
      }
      for (let s = 0; s < rows.length; s += SLICE_ROWS) {
        const slice = rows.slice(s, s + SLICE_ROWS);
        for (const r of slice) uc.add(r.inputs);
        pending += results.rows(slice);
        flush();
        while (results.written >= next) { say(`${fmtN(next)} rows\n`); next += PROGRESS_ROWS; }
      }
    }, range ? () => !!rs.header && rs.rows >= range!.last : undefined);
    requireHeader(rs, input);
    if (range && rs.rows < range.last) throw new DataError(`${input}: row count changed while reading (counted ${fmtN(totalRows)}, parsed ${fmtN(rs.rows)})`);
    flush(true);
    if (fd !== undefined) { closeSync(fd); fd = undefined; }
    renameSync(tmp, output);
  } catch (e) {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(tmp); } catch { /* nothing written */ }
    throw e;
  }

  const unitCheck = uc.finish(c.units);
  const doc = {
    ...settingsFile({
      version: ISAT_VERSION, timestamp: new Date().toISOString(), fileName: basename(input), delimiter: rs.delimiter ?? 'comma',
      units: { ...c.units, insulin_factor_pmol_per_uU: c.factors.insulin, glucose_factor_mg_per_dL_per_mmol: c.factors.glucose },
      settings: c.settings, avignon: av, orientation, includeStatus, unitCheck,
      rows: chunk
        ? { total: results.written, withProblems: results.withProblems, calculated: results.written }
        : { total: rs.rows, withProblems: results.withProblems, calculated: rs.rows },
    }),
    interface: 'cli',
    command: commandLine,
    ...(chunk && range ? {
      chunk: { index: chunk.index, of: chunk.of, first_row: range.first, last_row: range.last, total_rows: totalRows },
      input_fingerprint: {
        size_bytes: statSync(input).size, total_rows: totalRows,
        header_sha256: createHash('sha256').update((rs.header ?? []).join('\u001f')).digest('hex'),
      },
    } : {}),
  };
  writeFileSync(settingsPath, JSON.stringify(doc, null, 2));

  for (const w of unitCheck.filter((i) => i.suggested !== null)) say(`${warningText(w)}\n`);
  if (!quiet) {
    io.out(`Wrote ${fmtN(results.written)} rows to ${output}\n`);
    io.out(`Rows with input problems: ${fmtN(results.withProblems)}\n`);
    io.out(`Settings: ${settingsPath}\n`);
  }
  return 0;
}

// ---------- entry ----------
export async function run(argv: string[], io: Io): Promise<number> {
  try {
    const [cmd, ...rest] = argv;
    if (cmd === undefined || cmd === '--help' || cmd === '-h' || cmd === 'help') { io.out(USAGE); return cmd === undefined ? 1 : 0; }
    if (cmd === '--version' || cmd === '-v') return cmdVersion(io);
    if (!(cmd in HELP)) throw new UsageError(`unknown command "${cmd}" (try "isat --help")`);
    if (rest.includes('--help') || rest.includes('-h')) { io.out(HELP[cmd]!); return 0; }
    if (cmd === 'version') return cmdVersion(io);
    if (cmd === 'methods') return cmdMethods(rest, io);
    if (cmd === 'check') return cmdCheck(rest, io);
    if (cmd === 'merge') return cmdMerge(rest, io, ['isat', ...argv].join(' '));
    if (cmd === 'transform') return cmdTransform(rest, io, ['isat', ...argv].join(' '));
    return cmdCalculate(rest, io, ['isat', ...argv].join(' '));
  } catch (e) {
    if (e instanceof UsageError) { io.err(`error: ${e.message}\n`); return 1; }
    if (e instanceof DataError) { io.err(`error: ${e.message}\n`); return 2; }
    io.err(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
}


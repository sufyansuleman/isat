// ISAT command-line tool. Node built-ins only (so `deno compile` can build it). run() is exported for in-process tests.
import { closeSync, existsSync, openSync, readSync, renameSync, statSync, unlinkSync, writeSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import process from 'node:process';
import {
  AVIGNON_1999_WEIGHT, AvignonAccumulator, DEFAULT_SETTINGS, DEFAULT_UNIT_CHOICE, INCLUDED, ResultsStream, RowStream, UnitCheckCollector,
  methodSpecs, settingsFile, toCanonical, warningText,
  type AvignonUse, type ConversionSettings, type DelimiterName, type StreamRow, type UnitChoice,
} from '@isat/core';
import { UsageError, parseArgs } from './args';
import { ISAT_VERSION } from './version';

export interface Io { out(s: string): void; err(s: string): void }

export function nodeIo(): Io {
  return { out: (s) => { process.stdout.write(s); }, err: (s) => { process.stderr.write(s); } };
}

/** File or data error (exit code 2). */
class DataError extends Error {}

const READ_BYTES = 1024 * 1024;
const WRITE_BYTES = 1024 * 1024;
const SLICE_ROWS = 5000;
const PROGRESS_ROWS = 100_000;
const MAX_LISTED_PROBLEMS = 20;

// ---------- help ----------
const USAGE = `ISAT command-line tool

Usage: isat <command> [options]

Commands:
  calculate <file> -o <out.csv>   Calculate all included indices for a CSV/TSV file
  check <file>                    Check a file (columns, problems, units) without calculating
  methods [--json]                List the included methods
  version                         Show the ISAT version and default conversion factors

Run "isat <command> --help" for details.

Examples:
  isat check cohort.csv --glucose-unit mg/dL
  isat calculate cohort.csv -o results.csv
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
  --quiet                            no progress or summary output
  --force                            overwrite existing output files
  -h, --help                         this text

Examples:
  isat calculate cohort.csv -o results.csv
  isat calculate cohort.csv -o results.csv --glucose-unit mg/dL --insulin-unit uU/mL --status-columns
  isat calculate cohort.csv -o results.csv --avignon-weight sample --orientation inv
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

// ---------- file access (sync, fixed-size reads) ----------
function* readPieces(path: string): Generator<string> {
  let fd: number;
  try { fd = openSync(path, 'r'); } catch (e) { throw new DataError(`cannot read ${path}: ${(e as NodeJS.ErrnoException).code ?? String(e)}`); }
  try {
    const buf = new Uint8Array(READ_BYTES);
    const dec = new TextDecoder('utf-8');
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      const s = dec.decode(buf.subarray(0, n), { stream: true });
      if (s !== '') yield s;
    }
    const tail = dec.decode();
    if (tail !== '') yield tail;
  } finally { closeSync(fd); }
}

function checkInput(path: string): void {
  if (!existsSync(path)) throw new DataError(`file not found: ${path}`);
  if (!statSync(path).isFile()) throw new DataError(`not a file: ${path}`);
}

/** Feeds a file through a RowStream, calling onRows for each batch of parsed rows. */
function streamFile(path: string, rs: RowStream, onRows: (rows: StreamRow[]) => void): void {
  for (const piece of readPieces(path)) { const rows = rs.push(piece); if (rows.length || rs.header) onRows(rows); }
  onRows(rs.end());
}

const fmtN = (n: number) => n.toLocaleString('en-GB');

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
    value: [...UNIT_VALUES, 'output', 'orientation', 'avignon-weight'],
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
    });
    requireHeader(rs, input);
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
      rows: { total: rs.rows, withProblems: results.withProblems, calculated: rs.rows },
    }),
    interface: 'cli',
    command: commandLine,
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
    return cmdCalculate(rest, io, ['isat', ...argv].join(' '));
  } catch (e) {
    if (e instanceof UsageError) { io.err(`error: ${e.message}\n`); return 1; }
    if (e instanceof DataError) { io.err(`error: ${e.message}\n`); return 2; }
    io.err(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
}


/** results.csv -> results.settings.json (extension replaced, other names get the suffix appended). */
export function settingsPathFor(output: string): string {
  return output.replace(/\.(csv|tsv|txt)$/i, '') + '.settings.json';
}

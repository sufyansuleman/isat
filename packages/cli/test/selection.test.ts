// Index selection (--include / --methods): the web export with the same selection is byte-identical, errors, merge.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  INCLUDED, SEP, checkUnits, composeCsv, loadTable, resolveSelection, runBatch, selectedMethods, settingsFile, toCanonical, transform,
  type AvignonUse, type ChunkPayload, type SelectionInput, type TransformKind, type UnitChoice,
} from '@isat/core';
import { run, settingsPathFor } from '../src/cli';
import { ISAT_VERSION } from '../src/version';

const root = resolve(__dirname, '../../..');
const template = readFileSync(resolve(root, 'apps/web/public/isat-template.csv'), 'utf8');
const islet = readFileSync(resolve(root, 'validation/fixtures/inputs_islet.csv'), 'utf8');

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'isat-sel-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

async function cli(...argv: string[]) {
  let out = '', err = '';
  const code = await run(argv, { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
}
const rd = (f: string) => readFileSync(f, 'utf8');

const UNITS: UnitChoice = { glucose: 'mmol/L', insulin: 'pmol/L', tg: 'mmol/L', hdl: 'mmol/L', ffa: 'mmol/L' };

/** The web export with a selection: calculate everything, then composeCsv / settingsFile with the selected methods. */
function webRun(text: string, sel: SelectionInput, o: { orientation?: 'published' | 'sensitivity'; tf?: { kind: Exclude<TransformKind, 'none'>; bySex: boolean } } = {}) {
  const settings = { glucose_mg_per_dL_per_mmol: 18, insulin_pmol_per_uU: 6 };
  const l = loadTable(text);
  const units: UnitChoice = { ...UNITS, glucagon: 'pmol/L' };
  const rows = l.inputs.map((i) => toCanonical(i, units, settings));
  const runUnits: UnitChoice = { ...units };
  if (!l.columns.some((c) => c.kind === 'variable' && c.canonical?.startsWith('Glucagon'))) delete runUnits.glucagon;
  const chunks: ChunkPayload[] = [];
  let av: AvignonUse | undefined;
  for (const m of runBatch({ type: 'run', rows, ids: l.ids, problems: l.rowProblems, settings, avignon: 'default' })) {
    if (m.type === 'weight') av = m.use;
    if (m.type === 'chunk') chunks.push(m.payload);
  }
  const ids = resolveSelection(sel);
  const orientation = o.orientation ?? 'published';
  const sexes = l.inputs.map((i) => i.sex ?? null);
  const tf = o.tf && {
    suffix: `_${o.tf.kind}${o.tf.bySex ? '_bysex' : ''}`,
    cols: INCLUDED.map((m, c) => {
      if (!ids.includes(m.id)) return new Float64Array(0);
      const raw = new Float64Array(rows.length).fill(NaN);
      const flip = orientation === 'sensitivity' && m.direction === 'higher_more_resistant';
      let r = 0;
      for (const ch of chunks) for (const cell of ch.vals[c]!.split(SEP)) { if (cell !== '') { const v = Number(cell); raw[r] = flip ? (v === 0 ? 0 : -v) : v; } r++; }
      return transform(raw, o.tf!.kind, o.tf!.bySex ? { groups: sexes } : {}).values;
    }),
  };
  const csv = composeCsv(chunks, orientation, false, tf, selectedMethods(ids)).join('');
  const doc = settingsFile({
    version: ISAT_VERSION, timestamp: 'T', fileName: 'in.csv', delimiter: l.delimiter,
    units: { ...runUnits, insulin_factor_pmol_per_uU: '6', glucose_factor_mg_per_dL_per_mmol: '18' },
    settings, avignon: av!, orientation, includeStatus: false, unitCheck: checkUnits(l.inputs, runUnits),
    rows: { total: l.total, withProblems: l.rowsWithProblems, calculated: l.total }, selection: ids,
  });
  return { csv, doc };
}

async function calc(name: string, text: string, ...args: string[]) {
  const input = join(dir, `${name}.in.csv`), out = join(dir, `${name}.csv`);
  writeFileSync(input, text);
  const r = await cli('calculate', input, '-o', out, '--quiet', '--force', ...args);
  expect(r.err).toBe('');
  expect(r.code).toBe(0);
  return { input, out, csv: rd(out), settings: JSON.parse(rd(settingsPathFor(out))) as Record<string, unknown> };
}

const CASES: Array<[string, string[], SelectionInput]> = [
  ['--include secretion,glucagon', ['--include', 'secretion,glucagon'], { groups: ['secretion', 'glucagon'] }],
  ['--methods homa_ir,matsuda_3pt,di_bigtt', ['--methods', 'homa_ir,matsuda_3pt,di_bigtt'], { ids: ['homa_ir', 'matsuda_3pt', 'di_bigtt'] }],
  ['--include fasting --methods matsuda_3pt', ['--include', 'fasting', '--methods', 'matsuda_3pt'], { groups: ['fasting'], ids: ['matsuda_3pt'] }],
];

describe('selection: CLI equals the web export with the same selection, byte for byte', () => {
  for (const [label, text] of [['template', template], ['islet fixtures', islet]] as const) {
    for (const [name, args, sel] of CASES) {
      it(`${label}: ${name}`, async () => {
        const g = await calc('s1', text, ...args);
        const w = webRun(text, sel);
        expect(g.csv).toBe(w.csv);
        expect(g.settings['selection']).toEqual(w.doc['selection']);
        expect(g.settings['methods']).toEqual(w.doc['methods']);
        expect(g.csv.split('\r\n')[0]!.split(',').length).toBe(2 + resolveSelection(sel).length);
      });
      it(`${label}: ${name}, --orientation inv`, async () => {
        const g = await calc('s2', text, ...args, '--orientation', 'inv');
        expect(g.csv).toBe(webRun(text, sel, { orientation: 'sensitivity' }).csv);
      });
      it(`${label}: ${name}, transform rint within sex`, async () => {
        const g = await calc('s3', text, ...args);
        const out = join(dir, 's3_rint.csv');
        const r = await cli('transform', g.out, '-o', out, '--method', 'rint', '--within-sex', '--input', g.input, '--quiet', '--force');
        expect(r.err).toBe('');
        expect(rd(out)).toBe(webRun(text, sel, { tf: { kind: 'rint', bySex: true } }).csv);
        const st = JSON.parse(rd(settingsPathFor(out))) as Record<string, unknown>;
        expect(st['selection']).toEqual(g.settings['selection']);
      });
    }
  }

  it('the default selection (nothing, or --include all) leaves the CSV and the settings unchanged', async () => {
    const a = await calc('d1', template);
    const b = await calc('d2', template, '--include', 'all');
    expect(b.csv).toBe(a.csv);
    expect('selection' in a.settings).toBe(false);
    expect('selection' in b.settings).toBe(false);
    expect(a.csv).toBe(webRun(template, {}).csv);
    expect((a.settings['methods'] as unknown[]).length).toBe(INCLUDED.length);
  });

  it('an orientation with --status-columns follows the selection', async () => {
    const g = await calc('d3', template, '--include', 'secretion', '--status-columns');
    const head = g.csv.split('\r\n')[0]!.split(',');
    const n = resolveSelection({ groups: ['secretion'] }).length;
    expect(head.length).toBe(2 + 2 * n);
    expect(head.slice(2 + n)).toEqual(head.slice(2, 2 + n).map((h) => `${h}_status`));
  });
});

describe('selection: options and errors', () => {
  it('unknown group or id is a usage error that lists the allowed names', async () => {
    const input = join(dir, 'e.in.csv');
    writeFileSync(input, template);
    const out = join(dir, 'e.csv');
    const g = await cli('calculate', input, '-o', out, '--include', 'fasting,bogus', '--force');
    expect(g.code).toBe(1);
    expect(g.err).toMatch(/--include: unknown index group "bogus" \(use: fasting, ogtt, lipid, tracer_dxa, secretion, glucagon, all\)/);
    const m = await cli('calculate', input, '-o', out, '--methods', 'homa_ir,nope', '--force');
    expect(m.code).toBe(1);
    expect(m.err).toMatch(/--methods: unknown index id "nope" \(use: .*homa_ir/);
    expect((await cli('calculate', input, '-o', out, '--include', ',', '--force')).code).toBe(1);
    expect((await cli('calculate', input, '-o', out, '--methods', '', '--force')).code).toBe(1);
    expect(existsSync(out)).toBe(false);
  });

  it('check reports what would be included only when asked', async () => {
    const input = join(dir, 'c.in.csv');
    writeFileSync(input, template);
    const plain = await cli('check', input);
    expect(plain.out).not.toMatch(/would write/);
    const c = await cli('check', input, '--include', 'secretion');
    expect(c.code).toBe(0);
    expect(c.out).toMatch(new RegExp(`Indices that calculate would write: ${resolveSelection({ groups: ['secretion'] }).length} of ${INCLUDED.length} \\(groups: secretion;`));
    expect((await cli('check', input, '--include', 'x')).code).toBe(1);
  });

  it('help mentions --include with the example', async () => {
    const h = (await cli('calculate', '--help')).out;
    expect(h).toMatch(/--include <groups>/);
    expect(h).toMatch(/--methods <ids>/);
    expect(h).toMatch(/isat calculate cohort\.csv -o results\.csv --include fasting,secretion/);
  });
});

describe('selection: merge requires the same selection in every chunk', () => {
  async function chunk(name: string, i: number, n: number, ...extra: string[]) {
    const input = join(dir, `${name}.in.csv`);
    writeFileSync(input, template);
    const f = join(dir, `${name}_c${i}.csv`);
    expect((await cli('calculate', input, '-o', f, '--chunk', `${i}/${n}`, '--quiet', '--force', ...extra)).code).toBe(0);
    return f;
  }
  it('same selection merges and equals the unchunked run', async () => {
    const a = await chunk('m1', 1, 2, '--include', 'secretion');
    const b = await chunk('m1', 2, 2, '--include', 'secretion');
    const out = join(dir, 'm1_out.csv');
    const r = await cli('merge', a, b, '-o', out, '--quiet', '--force');
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const whole = await calc('m1w', template, '--include', 'secretion');
    expect(rd(out)).toBe(whole.csv);
    expect((JSON.parse(rd(settingsPathFor(out))) as Record<string, unknown>)['selection']).toEqual(whole.settings['selection']);
  });
  it('different selections are refused (exit 2)', async () => {
    const a = await chunk('m2', 1, 2, '--include', 'secretion');
    const b = await chunk('m2', 2, 2, '--include', 'glucagon');
    const out = join(dir, 'm2_out.csv');
    const r = await cli('merge', a, b, '-o', out, '--force');
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/index selection/);
    expect(existsSync(out)).toBe(false);
    const c = await chunk('m3', 1, 2);
    const d = await chunk('m3', 2, 2, '--include', 'all', '--methods', 'homa_ir');
    expect((await cli('merge', c, d, '-o', out, '--force')).code).toBe(0);
  });
});

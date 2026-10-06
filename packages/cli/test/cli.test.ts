import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  INCLUDED, composeCsv, loadTable, parseDelimited, runBatch, settingsFile, toCanonical, checkUnits,
  type AvignonUse, type UnitChoice,
} from '@isat/core';
import { isBrokenPipe, run, settingsPathFor, shortRef } from '../src/cli';
import { ISAT_VERSION } from '../src/version';

const root = resolve(__dirname, '../../..');
const fixtures = readFileSync(resolve(root, 'validation/fixtures/inputs.csv'), 'utf8');
const template = readFileSync(resolve(root, 'apps/web/public/isat-template.csv'), 'utf8');

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'isat-cli-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

async function cli(...argv: string[]) {
  let out = '', err = '';
  const code = await run(argv, { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
}

const DEFAULTS: UnitChoice = { glucose: 'mmol/L', insulin: 'pmol/L', tg: 'mmol/L', hdl: 'mmol/L', ffa: 'mmol/L' };

interface WebOpts { units?: UnitChoice; orientation?: 'published' | 'sensitivity'; status?: boolean; avignon?: 'default' | 'cohort'; factors?: { insulin: string; glucose: string } }

/** The web export path, step for step (load -> toCanonical -> runBatch -> composeCsv -> settingsFile). */
function webRun(text: string, o: WebOpts = {}) {
  const units = o.units ?? DEFAULTS;
  const factors = o.factors ?? { insulin: '6', glucose: '18' };
  const settings = { glucose_mg_per_dL_per_mmol: Number(factors.glucose), insulin_pmol_per_uU: Number(factors.insulin) };
  const l = loadTable(text);
  const rows = l.inputs.map((i) => toCanonical(i, units, settings));
  const chunks = [];
  let av: AvignonUse | undefined;
  for (const m of runBatch({ type: 'run', rows, ids: l.ids, problems: l.rowProblems, settings, avignon: o.avignon ?? 'default' })) {
    if (m.type === 'weight') av = m.use;
    if (m.type === 'chunk') chunks.push(m.payload);
  }
  const orientation = o.orientation ?? 'published';
  const status = o.status ?? false;
  const csv = composeCsv(chunks, orientation, status).join('');
  const doc = settingsFile({
    version: ISAT_VERSION, timestamp: 'T', fileName: 'in.csv', delimiter: l.delimiter,
    units: { ...units, insulin_factor_pmol_per_uU: factors.insulin, glucose_factor_mg_per_dL_per_mmol: factors.glucose },
    settings, avignon: av!, orientation, includeStatus: status, unitCheck: checkUnits(l.inputs, units),
    rows: { total: l.total, withProblems: l.rowsWithProblems, calculated: l.total },
  });
  return { csv, doc };
}

async function calc(name: string, text: string, ...args: string[]) {
  const input = join(dir, `${name}.csv`), output = join(dir, `${name}.out.csv`);
  writeFileSync(input, text);
  const r = await cli('calculate', input, '-o', output, '--quiet', '--force', ...args);
  expect(r.err).toBe('');
  expect(r.code).toBe(0);
  return { csv: readFileSync(output, 'utf8'), settings: JSON.parse(readFileSync(settingsPathFor(output), 'utf8')) as Record<string, unknown> };
}

describe('golden: CLI output is byte-identical to the web export path', () => {
  for (const [label, text] of [['validation inputs', fixtures], ['template', template]] as const) {
    it(`${label}, default units`, async () => {
      const g = await calc('g1', text);
      expect(g.csv).toBe(webRun(text).csv);
      expect(g.csv.split('\r\n').length).toBeGreaterThan(3);
    });
    it(`${label}, --orientation inv --status-columns`, async () => {
      const g = await calc('g2', text, '--orientation', 'inv', '--status-columns');
      expect(g.csv).toBe(webRun(text, { orientation: 'sensitivity', status: true }).csv);
    });
  }

  it('template converted to mg/dL, uU/mL, umol/L, 6.945 and 18.016', async () => {
    const t = parseDelimited(template, ',');
    const h = t[0]!;
    const scale = (row: string[], re: RegExp, k: number) => h.forEach((n, c) => { if (re.test(n) && row[c]) row[c] = String(Number(row[c]) * k); });
    const body = t.slice(1);
    for (const row of body) {
      scale(row, /^(fasting_glucose|glucose_\d+)$/, 18.016);
      scale(row, /^(fasting_insulin|insulin_\d+)$/, 1 / 6.945);
      scale(row, /^TG$/, 88.57);
      scale(row, /^HDL_c$/, 38.67);
      scale(row, /^FFA$/, 1000);
    }
    const text = [h, ...body].map((r) => r.join(',')).join('\r\n') + '\r\n';
    const units: UnitChoice = { glucose: 'mg/dL', insulin: 'uU/mL', tg: 'mg/dL', hdl: 'mg/dL', ffa: 'umol/L' };
    const g = await calc('g3', text, '--glucose-unit', 'mg/dL', '--insulin-unit', 'µU/mL', '--tg-unit', 'mg/dL', '--hdl-unit', 'mg/dL', '--ffa-unit', 'umol/L', '--glucose-factor', '18.016', '--insulin-factor', '6.945');
    const ref = webRun(text, { units, factors: { insulin: '6.945', glucose: '18.016' } });
    expect(g.csv).toBe(ref.csv);
    expect(g.settings['units']).toEqual(ref.doc['units']);
  });

  it('--avignon-weight sample matches the web "derived from this cohort" run', async () => {
    const g = await calc('g4', template, '--avignon-weight', 'sample');
    expect(g.csv).toBe(webRun(template, { avignon: 'cohort' }).csv);
    expect((g.settings['avignon_weight'] as { source: string }).source).toBe('sample');
  });

  it('--avignon-weight <number> uses that weight', async () => {
    const g = await calc('g5', template, '--avignon-weight', '0.2');
    expect(g.settings['avignon_weight']).toEqual({ value: 0.2, source: 'user' });
    expect(g.csv).not.toBe(webRun(template).csv);
  });

  it('semicolon files: detected or forced', async () => {
    const semi = template.split(/\r?\n/).map((l) => l.replace(/,/g, ';')).join('\n');
    expect((await calc('g6', semi)).csv).toBe(webRun(template).csv);
    expect((await calc('g7', semi, '--delimiter', 'semicolon')).csv).toBe(webRun(template).csv);
  });
});

describe('settings file', () => {
  it('matches the web settings file except interface, command and timestamp', async () => {
    const g = await calc('s1', template, '--status-columns');
    const ref = webRun(template, { status: true }).doc;
    const got = { ...g.settings };
    expect(got['interface']).toBe('cli');
    expect(String(got['command'])).toContain('calculate');
    expect(typeof got['timestamp']).toBe('string');
    for (const k of ['interface', 'command', 'timestamp', 'input_file']) delete got[k];
    const exp = JSON.parse(JSON.stringify(ref)) as Record<string, unknown>;
    delete exp['timestamp']; delete exp['input_file'];
    expect(got).toEqual(exp);
    expect(g.settings['input_file']).toBe('s1.csv');
    expect((g.settings['methods'] as unknown[]).length).toBe(INCLUDED.length);
  });
});

describe('check', () => {
  const mgdl = template.split(/\r?\n/).map((l, i) => {
    if (i === 0 || l === '') return l;
    const c = l.split(',');
    // fasting_glucose is column 6 (0-based); glucose_30..120 are 11..14
    for (const k of [6, 11, 12, 13, 14]) c[k] = String(Number(c[k]) * 18);
    return c.join(',');
  }).join('\n');

  it('warns when a mg/dL file is read with default units, not with the right unit', async () => {
    const f = join(dir, 'mgdl.csv'); writeFileSync(f, mgdl);
    const bad = await cli('check', f);
    expect(bad.code).toBe(0);
    expect(bad.out).toMatch(/Fasting glucose: median .* looks like mg\/dL, but mmol\/L is selected/);
    const ok = await cli('check', f, '--glucose-unit', 'mg/dL');
    expect(ok.out).toContain('Unit check: no warnings');
  });

  it('reports rows, delimiter, columns, problems and the cohort Avignon weight', async () => {
    const f = join(dir, 'prob.csv');
    writeFileSync(f, 'id,G0,I0,mystery\nA,5,40,x\nB,"5,5",40,y\nC,5,abc,z\n');
    const r = await cli('check', f);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Rows: 3');
    expect(r.out).toContain('Delimiter: comma');
    expect(r.out).toContain('Unrecognised columns, ignored (1): mystery');
    expect(r.out).toContain('Rows with problems: 2');
    expect(r.out).toContain('row 2 (B)');
    expect(r.out).toContain('Avignon SiM weight derived from this cohort');
  });

  it('matches the web cohort weight', async () => {
    const f = join(dir, 'tmpl.csv'); writeFileSync(f, template);
    const r = await cli('check', f);
    const w = /derived from this cohort: ([0-9.e-]+)/.exec(r.out)![1]!;
    const ref = webRun(template, { avignon: 'cohort' }).doc['avignon_weight'] as { value: number };
    expect(Number(w)).toBe(ref.value);
  });

  it('exit code 2 for a missing file, an empty file and column conflicts', async () => {
    expect((await cli('check', join(dir, 'nope.csv'))).code).toBe(2);
    const e = join(dir, 'empty.csv'); writeFileSync(e, '');
    expect((await cli('check', e)).code).toBe(2);
    const c = join(dir, 'conflict.csv'); writeFileSync(c, 'id,fasting_glucose,G0\nA,5,5\n');
    const r = await cli('check', c);
    expect(r.code).toBe(2);
    expect(r.out).toContain('both give fasting glucose');
  });
});

describe('usage and errors', () => {
  it('help and version', async () => {
    expect((await cli('--help')).out).toContain('Usage: isat');
    expect((await cli('calculate', '--help')).out).toContain('--avignon-weight');
    const v = await cli('version');
    expect(v.out).toContain(`ISAT ${ISAT_VERSION}`);
    expect(v.out).toContain('18 mg/dL per mmol/L');
  });

  it('usage errors exit 1 with one line on stderr', async () => {
    const cases = [
      ['bogus'], ['calculate', 'x.csv'], ['calculate', 'x.csv', '-o', 'y.csv', '--glucose-unit', 'ml'],
      ['calculate', 'x.csv', '-o', 'y', '--insulin-factor', '7'], ['check'], ['check', 'a', '--nope'],
    ];
    for (const a of cases) {
      const r = await cli(...a);
      expect(r.code, a.join(' ')).toBe(1);
      expect(r.err.trim().split('\n').length).toBe(1);
      expect(r.err).toMatch(/^error: /);
    }
  });

  it('refuses to overwrite without --force; data errors exit 2', async () => {
    const input = join(dir, 'ow.csv'), out = join(dir, 'ow.out.csv');
    writeFileSync(input, template); writeFileSync(out, 'keep');
    const r = await cli('calculate', input, '-o', out);
    expect(r.code).toBe(2);
    expect(readFileSync(out, 'utf8')).toBe('keep');
    expect((await cli('calculate', input, '-o', out, '--force', '--quiet')).code).toBe(0);
    expect((await cli('calculate', join(dir, 'missing.csv'), '-o', join(dir, 'm.csv'))).code).toBe(2);
    const bad = join(dir, 'bad.csv'); writeFileSync(bad, 'id,foo\n1,2\n');
    expect((await cli('calculate', bad, '-o', join(dir, 'bad.out.csv'))).code).toBe(2);
    expect(existsSync(join(dir, 'bad.out.csv'))).toBe(false);
    expect(existsSync(join(dir, 'bad.out.csv.partial'))).toBe(false);
  });

  it('methods lists included methods only; --json parses', async () => {
    const j = JSON.parse((await cli('methods', '--json')).out) as Array<{ id: string; reference: string }>;
    expect(j.map((m) => m.id)).toEqual(INCLUDED.map((m) => m.id));
    expect(j.every((m) => m.reference !== '')).toBe(true);
    const t = (await cli('methods')).out.trim().split('\n');
    expect(t.length).toBe(INCLUDED.length + 1);
    expect(shortRef('Gastaldelli A, Gaggini M. Role of Adipose Tissue. Diabetes. 2017;66(4):815.')).toBe('Gastaldelli et al. 2017');
  });
});

describe('streaming', () => {
  it('calculates a generated 50,000-row file and the row count matches', async () => {
    const input = join(dir, 'big.csv'), out = join(dir, 'big.out.csv');
    const header = 'participant_id,age,sex,weight,bmi,waist,fasting_glucose,fasting_insulin,TG,HDL_c,FFA,glucose_30,glucose_60,glucose_90,glucose_120,insulin_30,insulin_60,insulin_90,insulin_120\n';
    const N = 50_000;
    let s = 17;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const lines: string[] = [header];
    for (let k = 1; k <= N; k++) {
      lines.push([`P${k}`, 30 + Math.floor(rnd() * 40), k % 2 ? 'male' : 'female', (60 + rnd() * 40).toFixed(1), (20 + rnd() * 12).toFixed(1), 70 + Math.floor(rnd() * 40),
        (4.5 + rnd() * 1.5).toFixed(2), rnd() < 0.05 ? '' : (30 + rnd() * 60).toFixed(0), (0.8 + rnd()).toFixed(2), (1 + rnd() * 0.8).toFixed(2), (0.3 + rnd() * 0.4).toFixed(2),
        (6 + rnd() * 3).toFixed(1), (6 + rnd() * 3).toFixed(1), (5 + rnd() * 3).toFixed(1), (5 + rnd() * 3).toFixed(1),
        (300 + rnd() * 300).toFixed(0), (300 + rnd() * 300).toFixed(0), (200 + rnd() * 200).toFixed(0), (150 + rnd() * 200).toFixed(0)].join(','));
    }
    writeFileSync(input, lines.join('\n') + '\n');
    const r = await cli('calculate', input, '-o', out, '--quiet');
    expect(r.code).toBe(0);
    const text = readFileSync(out, 'utf8');
    let n = 0;
    for (let k = text.indexOf('\n'); k !== -1; k = text.indexOf('\n', k + 1)) n++;
    expect(n).toBe(N + 1);
    const doc = JSON.parse(readFileSync(settingsPathFor(out), 'utf8')) as { row_counts: { total: number } };
    expect(doc.row_counts.total).toBe(N);
  }, 120_000);
});

describe('closed output pipe', () => {
  it('exits quietly with 0 when the reader stops early (Node EPIPE or Deno BrokenPipe)', async () => {
    for (const err of [Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }), Object.assign(new Error('Broken pipe (os error 32)'), { name: 'BrokenPipe' })]) {
      let stderr = '';
      const code = await run(['methods'], { out: () => { throw err; }, err: (s) => { stderr += s; } });
      expect(code).toBe(0);
      expect(stderr).toBe('');
    }
    expect(isBrokenPipe(new Error('ENOENT: no such file'))).toBe(false);
  });
});

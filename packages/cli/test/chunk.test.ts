import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { INCLUDED, SEP, composeCsv, type ChunkPayload, loadTable, runBatch, toCanonical, transform, type TransformKind } from '@isat/core';
import { chunkRange, run, settingsPathFor } from '../src/cli';

const root = resolve(__dirname, '../../..');
const fixtures = readFileSync(resolve(root, 'validation/fixtures/inputs.csv'), 'utf8');
const template = readFileSync(resolve(root, 'apps/web/public/isat-template.csv'), 'utf8');

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'isat-chunk-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

async function cli(...argv: string[]) {
  let out = '', err = '';
  const code = await run(argv, { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
}
const rd = (f: string) => readFileSync(f, 'utf8');

function generate(n: number): string {
  let s = 99;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const lines = ['participant_id,age,sex,weight,bmi,waist,fasting_glucose,fasting_insulin,TG,HDL_c,FFA,glucose_30,glucose_60,glucose_90,glucose_120,insulin_30,insulin_60,insulin_90,insulin_120'];
  for (let k = 1; k <= n; k++) {
    lines.push([`P${k}`, 30 + Math.floor(rnd() * 40), k % 3 === 0 ? 'female' : k % 7 === 0 ? '' : k % 2 ? 'male' : 'female', (60 + rnd() * 40).toFixed(1), (20 + rnd() * 12).toFixed(1), 70 + Math.floor(rnd() * 40),
      (4.5 + rnd() * 1.5).toFixed(2), rnd() < 0.05 ? '' : (30 + rnd() * 60).toFixed(0), (0.8 + rnd()).toFixed(2), (1 + rnd() * 0.8).toFixed(2), (0.3 + rnd() * 0.4).toFixed(2),
      (6 + rnd() * 3).toFixed(1), (6 + rnd() * 3).toFixed(1), (5 + rnd() * 3).toFixed(1), (5 + rnd() * 3).toFixed(1),
      (300 + rnd() * 300).toFixed(0), (300 + rnd() * 300).toFixed(0), (200 + rnd() * 200).toFixed(0), (150 + rnd() * 200).toFixed(0)].join(','));
  }
  return lines.join('\n') + '\n';
}

async function calcFile(name: string, text: string, ...args: string[]) {
  const input = join(dir, `${name}.in.csv`), out = join(dir, `${name}.csv`);
  writeFileSync(input, text);
  const r = await cli('calculate', input, '-o', out, '--quiet', '--force', ...args);
  expect(r.err).toBe('');
  expect(r.code).toBe(0);
  return { input, out };
}

/** Runs all n chunks and merges; returns the merged path. */
async function chunkedMerge(name: string, text: string, n: number, extra: string[] = []) {
  const input = join(dir, `${name}.in.csv`);
  writeFileSync(input, text);
  const files: string[] = [];
  for (let i = 1; i <= n; i++) {
    const f = join(dir, `${name}_c${i}of${n}.csv`);
    const r = await cli('calculate', input, '-o', f, '--chunk', `${i}/${n}`, '--quiet', '--force', ...extra);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    files.push(f);
  }
  return { input, files };
}

describe('chunk boundaries', () => {
  it('partition N rows into contiguous blocks', () => {
    for (const [N, n] of [[10, 3], [5000, 7], [3, 7], [0, 4], [7, 7], [1, 1]] as const) {
      let next = 1;
      for (let i = 1; i <= n; i++) {
        const { first, last } = chunkRange(i, n, N);
        expect(first).toBe(next);
        expect(last).toBeGreaterThanOrEqual(first - 1);
        next = last + 1;
      }
      expect(next - 1).toBe(N);
    }
    expect(chunkRange(1, 3, 10)).toEqual({ first: 1, last: 3 });
    expect(chunkRange(2, 3, 10)).toEqual({ first: 4, last: 6 });
    expect(chunkRange(3, 3, 10)).toEqual({ first: 7, last: 10 });
  });

  it('n > N gives empty chunks with the header only; the settings record the block', async () => {
    const input = join(dir, 'tiny.csv');
    writeFileSync(input, template); // 10 rows
    const rows: number[] = [];
    for (let i = 1; i <= 13; i++) {
      const f = join(dir, `tiny_${i}.csv`);
      expect((await cli('calculate', input, '-o', f, '--chunk', `${i}/13`, '--quiet', '--force')).code).toBe(0);
      const lines = rd(f).split('\r\n').filter((l) => l !== '');
      rows.push(lines.length - 1);
      const st = JSON.parse(rd(settingsPathFor(f))) as { chunk: Record<string, number>; input_fingerprint: Record<string, unknown> };
      expect(st.chunk).toMatchObject({ index: i, of: 13, total_rows: 10 });
      expect(st.input_fingerprint['total_rows']).toBe(10);
      expect(st.chunk['last_row']! - st.chunk['first_row']! + 1).toBe(lines.length - 1);
    }
    expect(rows.reduce((a, b) => a + b, 0)).toBe(10);
    expect(rows.filter((r) => r === 0).length).toBe(3);
  });

  it('i out of range or malformed is a usage error; sample Avignon weight is refused', async () => {
    const input = join(dir, 'tiny.csv');
    for (const c of ['0/3', '4/3', '1/0', 'abc', '2', '-1/3', '1.5/3']) {
      const r = await cli('calculate', input, '-o', join(dir, 'x.csv'), '--chunk', c, '--force');
      expect(r.code, c).toBe(1);
      expect(r.err).toMatch(/^error: --chunk/);
    }
    const s = await cli('calculate', input, '-o', join(dir, 'x.csv'), '--chunk', '1/3', '--avignon-weight', 'sample', '--force');
    expect(s.code).toBe(1);
    expect(s.err).toContain('Cohort Avignon weight needs the whole file: run `isat check <file>` to get it, then pass --avignon-weight <number>.');
  });

  it('handles quoted newlines in IDs when counting rows', async () => {
    const text = 'participant_id,fasting_glucose,fasting_insulin\r\n"a\nb",5,40\r\nc,5.5,50\r\n"d""e",6,60\r\ne,6.5,70\r\n';
    const whole = await calcFile('qn', text);
    const { files } = await chunkedMerge('qn', text, 2);
    const merged = join(dir, 'qn_merged.csv');
    expect((await cli('merge', ...files, '-o', merged, '--quiet', '--force')).code).toBe(0);
    expect(rd(merged)).toBe(rd(whole.out));
  });
});

describe('chunked + merge equals unchunked, byte for byte', () => {
  const big = generate(5000);
  for (const [label, text] of [['generated 5,000 rows', big], ['validation fixtures', fixtures], ['template', template]] as const) {
    for (const n of [1, 3, 7]) {
      it(`${label}, n=${n}`, async () => {
        const args = ['--status-columns', '--orientation', 'inv'];
        const whole = await calcFile('w', text, ...args, '--avignon-weight', '0.15');
        const { files } = await chunkedMerge('m', text, n, [...args, '--avignon-weight', '0.15']);
        const merged = join(dir, 'merged.csv');
        // order of arguments and file names must not matter
        const r = await cli('merge', ...[...files].reverse(), '-o', merged, '--force');
        expect(r.code).toBe(0);
        expect(rd(merged)).toBe(rd(whole.out));
        const st = JSON.parse(rd(settingsPathFor(merged))) as Record<string, unknown>;
        expect(st['chunk']).toBeUndefined();
        expect((st['row_counts'] as { total: number }).total).toBe(text.split('\n').filter((l) => l.trim() !== '').length - 1);
        expect((st['merged_from'] as string[]).length).toBe(n);
      });
    }
  }

  it('default published Avignon weight: merged settings match the unchunked settings except run-specific fields', async () => {
    const whole = await calcFile('w2', template);
    const { files } = await chunkedMerge('m2', template, 3);
    const merged = join(dir, 'merged2.csv');
    expect((await cli('merge', ...files, '-o', merged, '--quiet', '--force')).code).toBe(0);
    const a = JSON.parse(rd(settingsPathFor(whole.out))) as Record<string, unknown>;
    const b = JSON.parse(rd(settingsPathFor(merged))) as Record<string, unknown>;
    for (const k of ['units', 'conversion_factors', 'avignon_weight', 'orientation', 'include_status_columns', 'row_counts', 'methods', 'isat_version']) expect(b[k]).toEqual(a[k]);
  });
});

describe('merge refuses inconsistent chunks (exit 2)', () => {
  it('missing chunk, duplicate chunk', async () => {
    const { files } = await chunkedMerge('r1', template, 3);
    const out = join(dir, 'r1_merged.csv');
    const miss = await cli('merge', files[0]!, files[2]!, '-o', out, '--force');
    expect(miss.code).toBe(2);
    expect(miss.err).toMatch(/missing chunk 2 of 3/);
    const dupe = await cli('merge', ...files, files[1]!, '-o', out, '--force');
    expect(dupe.code).toBe(2);
    expect(dupe.err).toMatch(/chunk 2\/3 given more than once/);
    expect(existsSync(out)).toBe(false);
  });

  it('different units, different input, different Avignon weight', async () => {
    const a = await chunkedMerge('r2', template, 2);
    const b = await chunkedMerge('r3', template, 2, ['--glucose-unit', 'mg/dL']);
    const out = join(dir, 'r2_merged.csv');
    const u = await cli('merge', a.files[0]!, b.files[1]!, '-o', out, '--force');
    expect(u.code).toBe(2);
    expect(u.err).toMatch(/differs from .* in units/);
    const c = await chunkedMerge('r4', fixtures, 2);
    const inp = await cli('merge', a.files[0]!, c.files[1]!, '-o', out, '--force');
    expect(inp.code).toBe(2);
    expect(inp.err).toMatch(/input file fingerprint/);
    const d = await chunkedMerge('r5', template, 2, ['--avignon-weight', '0.2']);
    const w = await cli('merge', a.files[0]!, d.files[1]!, '-o', out, '--force');
    expect(w.code).toBe(2);
    expect(w.err).toMatch(/Avignon weight/);
    expect(existsSync(out)).toBe(false);
  });

  it('different n, a non-chunk file, a truncated chunk, usage errors', async () => {
    const a = await chunkedMerge('r6', template, 2);
    const b = await chunkedMerge('r7', template, 3);
    const out = join(dir, 'r6_merged.csv');
    expect((await cli('merge', a.files[0]!, b.files[1]!, '-o', out, '--force')).code).toBe(2);
    const whole = await calcFile('r8', template);
    const nc = await cli('merge', whole.out, '-o', out, '--force');
    expect(nc.code).toBe(2);
    expect(nc.err).toContain('no chunk information');
    const f = a.files[1]!;
    const lines = rd(f).split('\r\n');
    writeFileSync(f, lines.slice(0, 2).join('\r\n') + '\r\n');
    const tr = await cli('merge', ...a.files, '-o', out, '--force');
    expect(tr.code).toBe(2);
    expect(tr.err).toMatch(/data rows, its settings say/);
    expect(existsSync(out)).toBe(false);
    expect(existsSync(out + '.partial')).toBe(false);
    expect((await cli('merge', '-o', out)).code).toBe(1);
    expect((await cli('merge', a.files[0]!)).code).toBe(1);
  });
});

// ---------- transform ----------
/** The web export path with "Add transformed columns" (Analysis.raw -> transform -> composeCsv). */
function webTransform(text: string, kind: Exclude<TransformKind, 'none'>, bySex: boolean): string {
  const l = loadTable(text);
  const settings = { glucose_mg_per_dL_per_mmol: 18, insulin_pmol_per_uU: 6 };
  const rows = l.inputs.map((i) => toCanonical(i, { glucose: 'mmol/L', insulin: 'pmol/L', tg: 'mmol/L', hdl: 'mmol/L', ffa: 'mmol/L' }, settings));
  const chunks: ChunkPayload[] = [];
  for (const m of runBatch({ type: 'run', rows, ids: l.ids, problems: l.rowProblems, settings, avignon: 'default' })) if (m.type === 'chunk') chunks.push(m.payload);
  const sexes = l.inputs.map((i) => i.sex ?? null);
  const cols = INCLUDED.map((_, c) => {
    const raw = new Float64Array(rows.length).fill(NaN);
    let r = 0;
    for (const ch of chunks) for (const cell of ch.vals[c]!.split(SEP)) { if (cell !== '') raw[r] = Number(cell); r++; }
    return transform(raw, kind, bySex ? { groups: sexes } : {}).values;
  });
  return composeCsv(chunks, 'published', false, { suffix: `_${kind}${bySex ? '_bysex' : ''}`, cols }).join('');
}

describe('transform: byte-identical to the web export', () => {
  for (const [label, text] of [['template', template], ['validation fixtures', fixtures], ['generated 300 rows', generate(300)]] as const) {
    for (const [kind, bySex] of [['rint', false], ['rint', true], ['log', false], ['z', false], ['z', true]] as const) {
      it(`${label}: ${kind}${bySex ? ' within sex' : ''}`, async () => {
        const c = await calcFile('t', text);
        const out = join(dir, 't_out.csv');
        const args = ['transform', c.out, '-o', out, '--method', kind, '--quiet', '--force', ...(bySex ? ['--within-sex', '--input', c.input] : [])];
        const r = await cli(...args);
        expect(r.err).toBe('');
        expect(r.code).toBe(0);
        expect(rd(out)).toBe(webTransform(text, kind, bySex));
      });
    }
  }

  it('settings: input settings carried forward plus the web-shaped transform block', async () => {
    const c = await calcFile('ts', template);
    const out = join(dir, 'ts_out.csv');
    expect((await cli('transform', c.out, '-o', out, '--method', 'log', '--force', '--quiet')).code).toBe(0);
    const st = JSON.parse(rd(settingsPathFor(out))) as Record<string, unknown>;
    const base = JSON.parse(rd(settingsPathFor(c.out))) as Record<string, unknown>;
    expect(st['units']).toEqual(base['units']);
    expect(st['row_counts']).toEqual(base['row_counts']);
    expect(st['transform']).toMatchObject({
      kind: 'log', within_sex: false, transformed_columns_added: true, column_suffix: '_log', blom_offset: 0.375, log_base: 'e', z_sd: 'sample (n - 1)',
    });
    expect(Object.keys((st['transform'] as { non_positive_set_to_missing: object }).non_positive_set_to_missing).length).toBe(INCLUDED.length);
  });

  it('--columns and --keep-only', async () => {
    const c = await calcFile('tk', template);
    const out = join(dir, 'tk_out.csv');
    expect((await cli('transform', c.out, '-o', out, '--method', 'z', '--columns', 'homa_ir,quicki', '--force', '--quiet')).code).toBe(0);
    const head = rd(out).split('\r\n')[0]!.split(',');
    expect(head).toContain('homa_ir_z');
    expect(head[head.indexOf('quicki') + 1]).toBe('quicki_z');
    expect(head.filter((h) => h.endsWith('_z')).length).toBe(2);
    const ko = join(dir, 'tk_ko.csv');
    expect((await cli('transform', c.out, '-o', ko, '--method', 'z', '--keep-only', '--force', '--quiet')).code).toBe(0);
    const kh = rd(ko).split('\r\n')[0]!.split(',');
    expect(kh[0]).toBe('participant_id');
    expect(kh.slice(1).every((h) => h.endsWith('_z'))).toBe(true);
    const bad = await cli('transform', c.out, '-o', join(dir, 'tk_bad.csv'), '--method', 'z', '--columns', 'nope');
    expect(bad.code).toBe(1);
  });

  it('within-sex errors: duplicate IDs, unknown ID, missing --input; non-merged chunk refused', async () => {
    const c = await calcFile('te', template);
    const out = join(dir, 'te_out.csv');
    const dupIn = join(dir, 'dup.in.csv');
    writeFileSync(dupIn, template.replace('SAMPLE_002', 'SAMPLE_001'));
    const d = await cli('transform', c.out, '-o', out, '--method', 'rint', '--within-sex', '--input', dupIn, '--force');
    expect(d.code).toBe(2);
    expect(d.err).toMatch(/duplicate participant IDs/);
    const unkIn = join(dir, 'unk.in.csv');
    writeFileSync(unkIn, template.replace('SAMPLE_002', 'OTHER_ID'));
    const u = await cli('transform', c.out, '-o', out, '--method', 'rint', '--within-sex', '--input', unkIn, '--force');
    expect(u.code).toBe(2);
    expect(u.err).toMatch(/not found/);
    expect(existsSync(out)).toBe(false);
    const dupRes = join(dir, 'dupres.csv');
    const lines = rd(c.out).split('\r\n');
    lines[2] = lines[1]!;
    writeFileSync(dupRes, lines.join('\r\n'));
    const dr = await cli('transform', dupRes, '-o', out, '--method', 'rint', '--within-sex', '--input', c.input, '--force');
    expect(dr.code).toBe(2);
    expect(dr.err).toMatch(/duplicate participant IDs/);
    expect((await cli('transform', c.out, '-o', out, '--method', 'rint', '--within-sex', '--force')).code).toBe(1);
    const { files } = await chunkedMerge('tc', template, 2);
    const ch = await cli('transform', files[0]!, '-o', out, '--method', 'rint', '--force');
    expect(ch.code).toBe(2);
    expect(ch.err).toContain('single chunk');
  });

  it('rows without a recognised sex get missing transformed values and are counted', async () => {
    const text = 'participant_id,sex,fasting_glucose,fasting_insulin\nA,male,5,40\nB,female,5.5,50\nC,,6,60\nD,male,6.5,70\nE,female,7,80\n';
    const c = await calcFile('tn', text);
    const out = join(dir, 'tn_out.csv');
    const r = await cli('transform', c.out, '-o', out, '--method', 'rint', '--within-sex', '--input', c.input, '--force');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Rows without a recognised sex (transformed value missing): 1');
    expect(rd(out)).toBe(webTransform(text, 'rint', true));
    const st = JSON.parse(rd(settingsPathFor(out))) as { transform: { rows_without_recognised_sex: number; group_n: Record<string, Record<string, number>> } };
    expect(st.transform.rows_without_recognised_sex).toBe(1);
  });
});

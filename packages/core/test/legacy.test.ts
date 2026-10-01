/// <reference types="node" />
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateAll, calculateBatch, orient, registry, parseCsv, parseWideRow } from '../src/index';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const csv = parseCsv(readFileSync(resolve(root, 'validation/fixtures/inputs.csv'), 'utf8'));
const legacy = JSON.parse(readFileSync(resolve(root, 'validation/fixtures/insusenscalc_0.1.0.json'), 'utf8')) as {
  rows: Record<string, number | string | null>[];
};
const rows = csv.map((r) => parseWideRow(r));
const legacyById = new Map(legacy.rows.map((r) => [String(r.participant_id), r]));

const relDiff = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);

const batch = calculateBatch(rows.map((r) => r.inputs), { avignon_weight: 'sample' }); // avignon_sim needs the full-sample weight
const diffRows: string[] = [];
const scaleRows: string[] = [];
const unavailRows: string[] = [];
let matched = 0;
const counts = new Map<string, number>();

describe('ISAT vs InsuSensCalc 0.1.0', () => {
  for (const [idx, row] of rows.entries()) {
    const id = row.participant_id!;
    const leg = legacyById.get(id)!;
    const results = batch[idx]!;
    it(`${id}: one result per method, no parse problems`, () => {
      expect(row.problems).toEqual([]);
      expect(results.length).toBe(registry.length);
    });
    for (const m of registry) {
      const r = results.find((x) => x.id === m.id)!;
      if (m.legacy.relation === 'none') continue;
      const col = typeof m.legacy.column === 'string' ? m.legacy.column : m.legacy.column?.[row.inputs.sex!];
      const L = col ? (leg[col] as number | null | undefined) ?? null : null;
      it(`${id} ${m.id} (${m.legacy.relation}, ${col})`, () => {
        if (r.status !== 'ok') {
          // unavailable: legacy must be null, or ISAT must name the missing inputs
          expect(r.status).toBe('unavailable');
          expect(r.reasons.length).toBeGreaterThan(0);
          unavailRows.push(`| ${id} | ${m.id} | ${r.reasons.join('; ')} | ${L === null ? 'null' : L} |`);
          expect(L === null || r.reasons.every((x) => x.startsWith('requires'))).toBe(true);
          return;
        }
        const v = r.value as number;
        if (m.legacy.relation === 'equal' || m.legacy.relation === 'negated') {
          expect(L, 'legacy value present').not.toBeNull();
          const expected = m.legacy.relation === 'negated' ? -(L as number) : (L as number);
          expect(relDiff(v, expected), `ISAT ${v} vs legacy-derived ${expected}`).toBeLessThan(1e-9);
          matched++;
          counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
        } else {
          expect(m.legacy.relation).toBe('different');
          if (L !== null && m.legacy.scale_factor) {
            // known constant-factor difference: gutt, ISAT = legacy x 18 x ln(10)
            expect(relDiff(v / L, 18 * Math.LN10)).toBeLessThan(1e-9);
            scaleRows.push(`| ${id} | ${m.id} | ${v} | ${L} | ${v / L} |`);
          } else if (L !== null) {
            expect(relDiff(v, L)).toBeGreaterThan(1e-9);
            diffRows.push(`| ${id} | ${m.id} | ${v} | ${L} |`);
          }
        }
      });
    }
  }

  it('sanity: Cederholm > 0 where all four time points exist, unavailable otherwise; legacy is negative for EX1', () => {
    for (const row of rows) {
      const r = calculateAll(row.inputs).find((x) => x.id === 'cederholm')!;
      if ([0, 30, 60, 120].every((tt) => row.inputs.glucose?.[tt] !== undefined && row.inputs.insulin?.[tt] !== undefined)) {
        expect(r.status).toBe('ok');
        expect(r.value as number).toBeGreaterThan(0);
      } else {
        expect(r.status).toBe('unavailable');
        expect(r.reasons.join(' ')).toMatch(/60-min/);
      }
    }
    expect(legacyById.get('EX1')!['Cederholm_index'] as number).toBeLessThan(0);
  });

  it('sanity: Belfiore ISI(gly) in (0, 2) for NGT rows, with reference set recorded', () => {
    for (const row of rows.filter((r) => r.participant_id!.startsWith('NGT'))) {
      const r = calculateAll(row.inputs).find((x) => x.id === 'belfiore_isi_gly')!;
      expect(r.status).toBe('ok');
      expect(r.value as number).toBeGreaterThan(0);
      expect(r.value as number).toBeLessThan(2);
      expect((r.details?.reference_set as { name: string }).name).toBe('belfiore_1998');
    }
  });

  it('orient(sensitivity) reproduces the legacy _inv columns', () => {
    let n = 0;
    for (const [idx, row] of rows.entries()) {
      const leg = legacyById.get(row.participant_id!)!;
      const out = orient(batch[idx]!, 'sensitivity');
      for (const r of out.filter((x) => x.id.endsWith('_inv'))) {
        const m = registry.find((x) => x.id === r.id.replace(/_inv$/, ''))!;
        const col = typeof m.legacy.column === 'string' ? m.legacy.column : m.legacy.column![row.inputs.sex!];
        expect(r.orientation).toBe('sensitivity');
        expect(r.status).toBe('ok');
        expect(relDiff(r.value as number, leg[col!] as number), `${row.participant_id} ${r.id}`).toBeLessThan(1e-9);
        n++;
      }
      expect(orient(batch[idx]!, 'published')).toEqual(batch[idx]);
    }
    expect(n).toBe(8 * 13); // 13 negated methods x 8 rows
  });

  afterAll(() => {
    const md = [
      '# ISAT vs InsuSensCalc 0.1.0: intentional differences',
      '',
      'Generated by `packages/core/test/legacy.test.ts`; do not edit by hand.',
      `Methods x rows matching legacy (equal/negated, rel. tol 1e-9): ${matched}.`,
      '',
      '## Methods with legacy relation `different`',
      '',
      '| row | method | ISAT value | legacy value |',
      '|---|---|---|---|',
      ...diffRows,
      '',
      '## Known constant-factor differences (ISAT = legacy x 18 x ln(10) = ' + 18 * Math.LN10 + ')',
      '',
      '| row | method | ISAT value | legacy value | ratio |',
      '|---|---|---|---|---|',
      ...scaleRows,
      '',
      '## ISAT unavailable (reason given; legacy value shown)',
      '',
      '| row | method | ISAT reasons | legacy value |',
      '|---|---|---|---|',
      ...unavailRows,
      '',
    ].join('\n');
    mkdirSync(resolve(root, 'validation'), { recursive: true });
    writeFileSync(resolve(root, 'validation/legacy-differences.md'), md);
    console.log(`legacy matches: ${matched}; different rows: ${diffRows.length}; unavailable: ${unavailRows.length}`);
    console.log([...counts].map(([k, v]) => `${k}:${v}`).join(' '));
  });
});

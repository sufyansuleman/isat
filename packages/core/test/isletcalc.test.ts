/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateAll, registry, parseCsv, parseWideRow } from '../src/index';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const rows = parseCsv(readFileSync(resolve(root, 'validation/fixtures/inputs_islet.csv'), 'utf8')).map((r) => parseWideRow(r));
const ref = JSON.parse(readFileSync(resolve(root, 'validation/fixtures/isletcalc_0.0.1.json'), 'utf8')) as {
  rows: Record<string, number | string | null>[];
};
const byId = new Map(ref.rows.map((r) => [String(r.participant_id), r]));
const relDiff = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);

// IsletCalc converts insulin with x 0.1667; ISAT divides by its insulin factor (default 6.0).
const ISLETCALC_FACTOR = 1 / 0.1667;
const equal = registry.filter((m) => m.isletcalc?.relation === 'equal');

describe('ISAT vs IsletCalc 0.0.1', () => {
  it('covers the 12 IsletCalc columns', () => {
    expect(equal.length).toBe(12);
    expect(new Set(equal.map((m) => m.isletcalc!.column)).size).toBe(12);
  });

  for (const row of rows) {
    const id = row.participant_id!;
    const leg = byId.get(id)!;
    const exact = calculateAll(row.inputs, { settings: { insulin_pmol_per_uU: ISLETCALC_FACTOR } });
    const dflt = calculateAll(row.inputs);
    for (const m of equal) {
      const L = leg[m.isletcalc!.column!] as number | null;
      it(`${id} ${m.id} (${m.isletcalc!.column}) with IsletCalc's insulin factor`, () => {
        const r = exact.find((x) => x.id === m.id)!;
        expect(r.status).toBe('ok');
        expect(L).not.toBeNull();
        expect(relDiff(r.value as number, L as number)).toBeLessThan(1e-9);
      });
      it(`${id} ${m.id} default factor differs by < 5e-4 (relative)`, () => {
        const r = dflt.find((x) => x.id === m.id)!;
        expect(relDiff(r.value as number, L as number)).toBeLessThan(5e-4);
      });
    }
  }

  it('indices IsletCalc does not compute have relation none', () => {
    const none = registry.filter((m) => m.isletcalc?.relation === 'none').map((m) => m.id).sort();
    expect(none).toEqual(['di_xinsg30_matsuda', 'glucagon_suppression_pct_60']);
  });
});

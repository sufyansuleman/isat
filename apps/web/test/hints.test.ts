import { describe, it, expect } from 'vitest';
import { calculateAll } from '@isat/core';
import { seriesHint, fieldHint, EXAMPLE_GLUCOSE, EXAMPLE_INSULIN, EXAMPLE_FIELDS } from '../src/calculate/hints';
import { buildInputs, emptyState } from '../src/calculate/state';

const mmol = { glucose: 'mmol/L', insulin: 'pmol/L', tg: 'mmol/L', hdl: 'mmol/L', ffa: 'mmol/L' } as const;
const mgdl = { glucose: 'mg/dL', insulin: 'uU/mL', tg: 'mg/dL', hdl: 'mg/dL', ffa: 'umol/L' } as const;

describe('example placeholders', () => {
  it('follow the selected units', () => {
    expect(seriesHint('glucose', 0, mmol)).toBe('e.g. 5.0');
    expect(seriesHint('glucose', 0, mgdl)).toBe('e.g. 90');
    expect(seriesHint('insulin', 0, mmol)).toBe('e.g. 42');
    expect(seriesHint('insulin', 0, mgdl)).toBe('e.g. 7');
    expect(fieldHint('tg', mgdl)).toBe('e.g. 89');
    expect(fieldHint('ffa', mgdl)).toBe('e.g. 450');
  });
  it('rows at non-standard times and tracer rates get no example', () => {
    expect(seriesHint('glucose', 45, mmol)).toBe('—');
    expect(fieldHint('rate_glycerol', mmol)).toBe('—');
  });
  it('are never used in a calculation: an empty form calculates nothing', () => {
    const rs = calculateAll(buildInputs(emptyState()).inputs);
    expect(rs.filter((r) => r.status === 'ok')).toHaveLength(0);
  });
  it('describe a plausible person: every example-value index is calculable without errors', () => {
    const rs = calculateAll({
      glucose: EXAMPLE_GLUCOSE, insulin: EXAMPLE_INSULIN, ffa: { 0: EXAMPLE_FIELDS.ffa! },
      tg: EXAMPLE_FIELDS.tg, hdl: EXAMPLE_FIELDS.hdl, age: EXAMPLE_FIELDS.age, weight: EXAMPLE_FIELDS.weight,
      bmi: EXAMPLE_FIELDS.bmi, waist: EXAMPLE_FIELDS.waist, sex: 'male',
    });
    expect(rs.filter((r) => r.status === 'error')).toHaveLength(0);
    expect(rs.find((r) => r.id === 'homa_ir')!.value).toBeCloseTo(5.0 * 7 / 22.5, 12);
  });
});

import { describe, it, expect } from 'vitest';
import {
  calculateAll, orient, registry, toUnit, DEFAULT_SETTINGS, DEFAULT_UNIT_CHOICE, loadTable, toCanonical, checkUnits,
  type UnitChoice,
} from '../src/index';

function loadTableFor(text: string) {
  const t = loadTable(text);
  const units = (u: Partial<UnitChoice>): UnitChoice => ({ ...DEFAULT_UNIT_CHOICE, ...u });
  return {
    ...t,
    canonical: (u: Partial<UnitChoice>) => t.inputs.map((i) => toCanonical(i, units(u), {})),
    check: (u: Partial<UnitChoice>) => checkUnits(t.inputs, units(u)),
  };
}

const base = {
  glucose: { 0: 5.0, 30: 8.0, 120: 6.0 }, insulin: { 0: 60, 30: 300, 120: 180 },
  glucagon: { 0: 8, 30: 6, 60: 5, 120: 6 }, bmi: 25, sex: 'male' as const,
};
const val = (inputs: object, id: string) => calculateAll(inputs).find((r) => r.id === id)!;

describe('secretion and glucagon indices', () => {
  it('registers 9 secretion and 5 glucagon indices, all descriptive with direction text', () => {
    const s = registry.filter((m) => m.category === 'secretion');
    const g = registry.filter((m) => m.category === 'glucagon');
    expect([s.length, g.length]).toEqual([9, 5]);
    for (const m of [...s, ...g]) {
      expect(m.direction).toBe('descriptive');
      expect(m.direction_text, m.id).toBeTruthy();
    }
  });

  it('hand-checked values', () => {
    expect(val(base, 'homa_beta').value).toBeCloseTo((20 * 10) / 1.5, 10);
    const g30 = 8 * 18;
    expect(val(base, 'cir30').value).toBeCloseTo((100 * 50) / (g30 * (g30 - 70)), 10);
    expect(val(base, 'stumvoll_first_phase').value).toBeCloseTo(1283 + 1.829 * 300 - 138.7 * 8 + 3.772 * 60, 8);
    expect(val(base, 'insulinogenic_dg30').value).toBeCloseTo((50 - 10) / ((8 - 5) * 18), 10);
    expect(val(base, 'insulinogenic_g30').value).toBeCloseTo(40 / 8, 10);
    expect(val(base, 'glucagon_fasting').value).toBe(8);
    expect(val(base, 'glucagon_auc').value).toBeCloseTo(0.5 * ((6 + 8) * 30 + (6 + 6) * 90), 10);
    expect(val(base, 'glucagon_ratio_120_0').value).toBeCloseTo(6 / 8, 12);
    expect(val(base, 'glucagon_suppression_pct_60').value).toBeCloseTo((1 - 5 / 8) * 100, 10);
    expect(val(base, 'glucagon_insulin_ratio').value).toBeCloseTo(8 / 60, 12);
  });

  it('DI products reuse Matsuda ISI and BIGTT-SI', () => {
    const m = val(base, 'matsuda_3pt').value as number;
    expect(val(base, 'di_xinsg30_matsuda').value).toBeCloseTo(5 * m, 10);
    const air = val(base, 'bigtt_air').value as number;
    const si = val(base, 'bigtt_si').value as number;
    expect(val(base, 'di_bigtt').value).toBeCloseTo(air * si, 8);
  });

  it('BIGTT-AIR uses male = 1 and female = 0', () => {
    const f = val({ ...base, sex: 'female' }, 'bigtt_air').value as number;
    const m = val(base, 'bigtt_air').value as number;
    expect(m / f).toBeCloseTo(Math.exp(0.18), 10);
  });

  it('homa_beta is unavailable when G0 <= 3.5', () => {
    const r = val({ ...base, glucose: { ...base.glucose, 0: 3.5 } }, 'homa_beta');
    expect(r.status).toBe('unavailable');
    expect(r.reasons[0]).toMatch(/3\.5/);
    expect(val({ ...base, glucose: { ...base.glucose, 0: 3.0 } }, 'homa_beta').status).toBe('unavailable');
  });

  it('cir30 is unavailable when G30 <= 70 mg/dL', () => {
    const r = val({ ...base, glucose: { ...base.glucose, 30: 70 / 18 } }, 'cir30');
    expect(r.status).toBe('unavailable');
    expect(val({ ...base, glucose: { ...base.glucose, 30: 3.0 } }, 'cir30').status).toBe('unavailable');
  });

  it('insulinogenic_dg30 is unavailable when G30 equals G0', () => {
    const r = val({ ...base, glucose: { ...base.glucose, 30: 5.0 } }, 'insulinogenic_dg30');
    expect(r.status).toBe('unavailable');
    expect(r.reasons[0]).toMatch(/equals fasting/);
  });

  it('missing 60-min glucagon: only the 60-min index is unavailable', () => {
    const noGl60 = { ...base, glucagon: { 0: 8, 30: 6, 120: 6 } };
    const r = val(noGl60, 'glucagon_suppression_pct_60');
    expect(r.status).toBe('unavailable');
    expect(r.reasons).toEqual(['requires 60-min glucagon']);
    expect(val(noGl60, 'glucagon_auc').status).toBe('ok');
  });

  it('no glucagon at all: glucagon indices unavailable with reasons, secretion unaffected', () => {
    const { glucagon: _g, ...noGl } = base;
    for (const m of registry.filter((x) => x.category === 'glucagon')) {
      const r = val(noGl, m.id);
      expect(r.status, m.id).toBe('unavailable');
      expect(r.reasons.length).toBeGreaterThan(0);
    }
    expect(val(noGl, 'homa_beta').status).toBe('ok');
  });

  it('invalid glucagon (0 or negative) is an error', () => {
    expect(val({ ...base, glucagon: { 0: 0 } }, 'glucagon_fasting').status).toBe('error');
    expect(val({ ...base, glucagon: { 0: -1 } }, 'glucagon_fasting').status).toBe('error');
  });

  it('pg/mL converts to pmol/L with 3.485', () => {
    expect(DEFAULT_SETTINGS.glucagon_pg_per_mL_per_pmol).toBe(3.485);
    expect(toUnit(34.85, 'glucagon', 'pg/mL', 'pmol/L')).toBeCloseTo(10, 12);
    expect(toUnit(10, 'glucagon', 'pmol/L', 'pg/mL')).toBeCloseTo(34.85, 12);
    expect(() => toUnit(1, 'glucagon', 'mmol/L' as never, 'pmol/L')).toThrow();
  });

  it('orient(sensitivity) never negates descriptive indices', () => {
    const res = calculateAll(base);
    const out = orient(res, 'sensitivity');
    for (const r of res.filter((x) => x.direction === 'descriptive')) {
      const o = out.find((x) => x.id === r.id)!;
      expect(o, r.id).toBeDefined();
      expect(o.value).toBe(r.value);
      expect(o.direction).toBe('descriptive');
    }
  });

  it('CSV columns Glucagon0, glucagon_30, fasting_glucagon and unit conversion', () => {
    const a = loadTableFor('id,Glucagon0,glucagon_30,Glucagon_60\nA,10,8,6\n');
    expect(a.inputs[0]!.glucagon).toEqual({ 0: 10, 30: 8, 60: 6 });
    const b = loadTableFor('id,fasting_glucagon\nA,34.85\n');
    expect(b.inputs[0]!.glucagon).toEqual({ 0: 34.85 });
    const c = loadTableFor('id,Glucagon0,fasting_glucagon\nA,1,2\n');
    expect(c.fileErrors.length).toBe(1);
    expect(b.canonical({ glucagon: 'pg/mL' })[0]!.glucagon![0]).toBeCloseTo(10, 10);
    expect(b.canonical({})[0]!.glucagon![0]).toBeCloseTo(34.85, 10);
  });

  it('unit check suggests pg/mL for a median above 30 and pmol/L below 25', () => {
    const hi = loadTableFor('id,Glucagon0\n' + Array.from({ length: 6 }, (_, k) => `r${k},${40 + k}`).join('\n') + '\n');
    expect(hi.check({}).find((i) => i.quantity === 'glucagon')!.suggested).toBe('pg/mL');
    expect(hi.check({ glucagon: 'pg/mL' }).find((i) => i.quantity === 'glucagon')!.suggested).toBeNull();
    const lo = loadTableFor('id,Glucagon0\n' + Array.from({ length: 6 }, (_, k) => `r${k},${5 + k}`).join('\n') + '\n');
    expect(lo.check({ glucagon: 'pg/mL' }).find((i) => i.quantity === 'glucagon')!.suggested).toBe('pmol/L');
    expect(lo.check({}).find((i) => i.quantity === 'glucagon')!.suggested).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import {
  matsuda5pt, summarize, parseWideRow, parseCsv, calculateAll, registry, toUnit, gutt, BELFIORE_1998,
} from '../src/index';

const close = (a: number | null, b: number, tol = 1e-12) => {
  expect(a).not.toBeNull();
  expect(Math.abs((a as number) - b) / Math.abs(b)).toBeLessThan(tol);
};

// Hand values from an independent node one-liner (not the implementation).
describe('matsuda_5pt', () => {
  it('NGT_M', () => {
    const r = matsuda5pt({
      glucose: { 0: 5.1, 30: 7.8, 60: 7.2, 90: 6.4, 120: 5.9 },
      insulin: { 0: 42, 30: 310, 60: 365, 90: 290, 120: 210 },
    });
    close(r.value, 5.734838896140319);
    expect(r.details?.time_points).toEqual([0, 30, 60, 90, 120]);
  });
  it('LEAN_F', () => {
    const r = matsuda5pt({
      glucose: { 0: 4.6, 30: 7.0, 60: 6.1, 90: 5.5, 120: 5.0 },
      insulin: { 0: 24, 30: 240, 60: 210, 90: 150, 120: 95 },
    });
    close(r.value, 11.13974407802697);
  });
  it('unavailable without all five points; never averages a partial set', () => {
    const r = matsuda5pt({ glucose: { 0: 5, 30: 6, 120: 7 }, insulin: { 0: 40, 30: 200, 120: 100 } });
    expect(r.status).toBe('unavailable');
    expect(r.reasons.join(' ')).toMatch(/60-min/);
  });
});

describe('units for TG/HDL/FFA', () => {
  it('conversions and settings', () => {
    close(toUnit(1, 'tg', 'mmol/L', 'mg/dL'), 88.57);
    close(toUnit(1, 'hdl', 'mmol/L', 'mg/dL'), 38.67);
    close(toUnit(398.88, 'ffa', 'umol/L', 'mmol/L'), 0.39888);
    close(toUnit(0.5, 'ffa', 'mmol/L', 'umol/L'), 500);
    expect(calculateAll({})[0]!.conversion.tg_mg_per_dL_per_mmol).toBe(88.57);
  });
});

describe('registry', () => {
  it('registers deferred methods as unavailable with the spec reason', () => {
    const rs = calculateAll({});
    expect(rs.length).toBe(registry.length);
    expect(rs.find((r) => r.id === 'homa2')!.reasons[0]).toBe('not included in this version: closed-source model');
    expect(rs.find((r) => r.id === 'bennett')!.status).toBe('unavailable');
  });
  it('provisional methods carry a warning on every result', () => {
    for (const id of ['gutt', 'cederholm']) {
      expect(calculateAll({}).find((r) => r.id === id)!.warnings.length).toBeGreaterThan(0);
    }
  });
  it('Belfiore uses belfiore_1998 by default and records it; custom reference overrides', () => {
    const inp = { insulin: { 0: 65.71 }, glucose: { 0: 5.08 } };
    const d = calculateAll(inp).find((r) => r.id === 'belfiore_basal')!;
    close(d.value, 1);
    expect((d.details!.reference_set as { name: string }).name).toBe('belfiore_1998');
    const c = calculateAll(inp, { reference: { insulin_0: 131.42, glucose_0: 5.08 } }).find((r) => r.id === 'belfiore_basal')!;
    expect((c.details!.reference_set as { name: string }).name).toBe('custom');
    expect(c.value).not.toBeCloseTo(1, 3);
    expect(BELFIORE_1998.ffa_0).toBeCloseTo(0.39888, 12);
  });
  it('sex-specific VAI/LAP need sex', () => {
    const r = calculateAll({ waist: 90, bmi: 25, tg: 1.8, hdl: 1.2 }).find((x) => x.id === 'vai')!;
    expect(r.status).toBe('unavailable');
    expect(r.reasons.join(' ')).toMatch(/sex/);
  });
  it('gutt errors on non-positive insulin', () => {
    expect(gutt({ glucose: { 0: 5, 120: 6 }, insulin: { 0: 0, 120: 5 }, weight: 70 }).status).toBe('error');
  });
});

describe('summarize', () => {
  it('trapezoid AUC over all supplied points', () => {
    const s = summarize({ glucose: { 0: 5, 30: 6, 120: 7.8 }, insulin: { 0: 7, 60: undefined } });
    close(s.glucose.auc, 15 * 11 + 45 * 13.8);
    expect(s.glucose.time_points).toEqual([0, 30, 120]);
    close(s.glucose.time_weighted_mean, (15 * 11 + 45 * 13.8) / 120);
    expect(s.insulin.auc).toBeNull();
    expect(s.insulin.reason).toMatch(/two/);
  });
});

describe('wide adapter', () => {
  it('maps sex, empties are missing not 0', () => {
    const rows = parseCsv('participant_id,age,sex,weight,G0,G60,I0,I60,FFA,TG,HDL_c\nA,30,1,70,5.0,,7,,2.0,1.8,1.2\nB,40,2,60,5.5,6,8,30,,,');
    const a = parseWideRow(rows[0]!), b = parseWideRow(rows[1]!);
    expect(a.inputs.sex).toBe('male');
    expect(b.inputs.sex).toBe('female');
    expect(a.inputs.glucose).toEqual({ 0: 5 });
    expect('60' in (a.inputs.glucose ?? {})).toBe(false);
    expect(a.inputs.ffa).toEqual({ 0: 2 });
    expect(a.inputs.tg).toBe(1.8);
    expect(a.inputs.hdl).toBe(1.2);
    expect(b.inputs.tg).toBeUndefined();
    expect(b.inputs.glucose).toEqual({ 0: 5.5, 60: 6 });
  });
  it('reports unparseable cells', () => {
    expect(parseWideRow({ G0: 'abc', sex: '3' }).problems.length).toBe(2);
  });
});

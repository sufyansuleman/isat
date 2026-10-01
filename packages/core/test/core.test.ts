import { describe, it, expect } from 'vitest';
import {
  quicki, firi, belfioreBasal, belfioreIsiGly, belfioreIsiFfa, calculateAll, registry, toUnit,
} from '../src/index';

const close = (a: number | null, b: number, tol = 1e-12) => {
  expect(a).not.toBeNull();
  expect(Math.abs((a as number) - b) / Math.abs(b)).toBeLessThan(tol);
};

describe('QUICKI', () => {
  it('matches hand values', () => {
    close(quicki({ glucose: { 0: 5.0 }, insulin: { 0: 7 } }).value, 0.4947582101588188);
    close(quicki({ glucose: { 0: 5.5 }, insulin: { 0: 60 } }).value, 0.33381901835158057);
  });
  it('mg/dL and uU/mL entered via units module give the same result', () => {
    const g = toUnit(99, 'glucose', 'mg/dL', 'mmol/L');
    const i = toUnit(10, 'insulin', 'uU/mL', 'pmol/L');
    close(quicki({ glucose: { 0: g }, insulin: { 0: i } }).value, 0.3338190183515806);
  });
  it('is not the natural-log legacy value', () => {
    const v = quicki({ glucose: { 0: 5.0 }, insulin: { 0: 7 } }).value as number;
    expect(Math.abs(v - 0.2148707605483044)).toBeGreaterThan(0.1);
  });
});

describe('FIRI', () => {
  it('matches hand values', () => {
    close(firi({ glucose: { 0: 5.0 }, insulin: { 0: 7 } }).value, 0.23333333333333336);
    close(firi({ glucose: { 0: 5.5 }, insulin: { 0: 60 } }).value, 2.2);
  });
  it('custom insulin factor changes FIRI', () => {
    const r = firi({ glucose: { 0: 5.5 }, insulin: { 0: 60 } }, { insulin_pmol_per_uU: 6.945 });
    close(r.value, (5.5 * (60 / 6.945)) / 25);
    expect(r.conversion.insulin_pmol_per_uU).toBe(6.945);
  });
});

describe('Belfiore', () => {
  const ref = { insulin_0: 60, glucose_0: 5.0 };
  it('basal', () => {
    close(belfioreBasal({ insulin: { 0: 72 }, glucose: { 0: 5.5 } }, ref).value, 0.8620689655172413);
    expect(belfioreBasal({ insulin: { 0: 60 }, glucose: { 0: 5.0 } }, ref).value).toBe(1);
  });
  it('ISI(gly) 0-1-2h', () => {
    const r = belfioreIsiGly(
      { insulin: { 0: 60, 60: 360, 120: 240 }, glucose: { 0: 5, 60: 8, 120: 6 } },
      { insulin_area_0_1_2h: 510, glucose_area_0_1_2h: 13.5 },
    );
    close(r.value, 1);
    expect(r.details?.variant).toBe('0_1_2h');
  });
  it('ISI(gly) 0-2h fallback; 30-min ignored', () => {
    const r = belfioreIsiGly(
      { insulin: { 0: 60, 30: 999, 120: 240 }, glucose: { 0: 5, 30: 99, 120: 6 } },
      { insulin_area_0_2h: 300, glucose_area_0_2h: 11 },
    );
    close(r.value, 1);
    expect(r.details?.variant).toBe('0_2h');
  });
  it('ISI(gly) needs refs for the variant used', () => {
    const r = belfioreIsiGly(
      { insulin: { 0: 60, 60: 360, 120: 240 }, glucose: { 0: 5, 60: 8, 120: 6 } },
      { insulin_area_0_2h: 300, glucose_area_0_2h: 11 },
    );
    expect(r.status).toBe('unavailable');
  });
  it('ISI(FFA) area and basal forms; no synthesised area', () => {
    const a = belfioreIsiFfa(
      { insulin: { 0: 60, 120: 240 }, ffa: { 0: 0.5, 120: 0.1 } },
      { insulin_area_0_2h: 300, ffa_area_0_2h: 0.6 },
    );
    close(a.value, 1);
    expect(a.details?.form).toBe('area');
    const b = belfioreIsiFfa({ insulin: { 0: 60 }, ffa: { 0: 0.5 } }, { insulin_0: 60, ffa_0: 0.5 });
    expect(b.value).toBe(1);
    expect(b.details?.form).toBe('basal');
    const c = belfioreIsiFfa({ insulin: { 0: 60 }, ffa: { 0: 0.5 } }, { insulin_area_0_2h: 300, ffa_area_0_2h: 0.6 });
    expect(c.status).toBe('unavailable');
  });
});

describe('missing / invalid data', () => {
  it('no insulin -> all families unavailable with reasons', () => {
    const rs = calculateAll({ glucose: { 0: 5 } }, { reference: { insulin_0: 60, glucose_0: 5 } })
      .filter((r) => ['quicki', 'firi', 'belfiore_basal', 'belfiore_isi_gly', 'belfiore_isi_ffa'].includes(r.id));
    expect(rs.length).toBe(5);
    for (const r of rs) {
      expect(r.status).toBe('unavailable');
      expect(r.reasons.join(' ')).toMatch(/insulin/);
    }
  });
  it('Belfiore without reference is unavailable', () => {
    for (const r of calculateAll({ glucose: { 0: 5 }, insulin: { 0: 60 } }, { reference: {} }).filter((r) => r.id.startsWith('belfiore'))) {
      expect(r.status).toBe('unavailable');
    }
    const r = belfioreBasal({ glucose: { 0: 5 }, insulin: { 0: 60 } });
    expect(r.reasons).toContain('requires normal-population reference means');
  });
  it('zero/negative glucose -> error', () => {
    expect(quicki({ glucose: { 0: 0 }, insulin: { 0: 60 } }).status).toBe('error');
    expect(firi({ glucose: { 0: -1 }, insulin: { 0: 60 } }).status).toBe('error');
    expect(belfioreBasal({ glucose: { 0: 0 }, insulin: { 0: 60 } }, { insulin_0: 60, glucose_0: 5 }).status).toBe('error');
  });
});

describe('units', () => {
  it('round-trips', () => {
    expect(toUnit(toUnit(5.5, 'glucose', 'mmol/L', 'mg/dL'), 'glucose', 'mg/dL', 'mmol/L')).toBeCloseTo(5.5, 12);
    expect(toUnit(toUnit(60, 'insulin', 'pmol/L', 'uU/mL'), 'insulin', 'uU/mL', 'pmol/L')).toBeCloseTo(60, 12);
    const s = { glucose_mg_per_dL_per_mmol: 18.016, insulin_pmol_per_uU: 6.945 };
    expect(toUnit(toUnit(5.5, 'glucose', 'mmol/L', 'mg/dL', s), 'glucose', 'mg/dL', 'mmol/L', s)).toBeCloseTo(5.5, 12);
  });
  it('uU/mL and mU/L identical', () => {
    expect(toUnit(10, 'insulin', 'uU/mL', 'pmol/L')).toBe(toUnit(10, 'insulin', 'mU/L', 'pmol/L'));
  });
});

describe('calculateAll', () => {
  it('returns one result per registered method', () => {
    const rs = calculateAll({});
    expect(rs.length).toBe(registry.length);
    expect(rs.map((r) => r.id)).toEqual(registry.map((m) => m.id));
    for (const r of rs) expect(r.conversion.glucose_mg_per_dL_per_mmol).toBe(18);
  });

  it('passes reference means through the registry to every method', () => {
    const rs = calculateAll(
      { glucose: { 0: 5.5, 60: 8, 120: 6 }, insulin: { 0: 72, 60: 360, 120: 240 } },
      { reference: { insulin_0: 60, glucose_0: 5.0, insulin_area_0_1_2h: 510, glucose_area_0_1_2h: 13.5 } },
    );
    const byId = Object.fromEntries(rs.map((r) => [r.id, r]));
    expect(byId.belfiore_basal!.value).toBeCloseTo(0.8620689655172413, 12);
    expect(byId.belfiore_isi_gly!.status).toBe('ok');
    expect(byId.quicki!.status).toBe('ok');
    expect(byId.firi!.value).toBeCloseTo(5.5 * 12 / 25, 12);
  });
});

import { CANONICAL, toUnit } from '@isat/core';
import { clean } from './format';
import { emptyState, DEFAULT_UNITS, settingsOf, type FormState, type UnitChoice } from './state';

/** NGT_M row of validation/fixtures/inputs.csv, canonical units (glucose mmol/L, insulin pmol/L, FFA mmol/L). */
export const NGT_M = {
  age: 45, sex: 'male' as const, weight: 78, bmi: 24.1, waist: 86, tg: 1.1, hdl: 1.45, ffa: 0.45,
  glucose: { 0: 5.1, 30: 7.8, 60: 7.2, 90: 6.4, 120: 5.9 } as Record<number, number>,
  insulin: { 0: 42, 30: 310, 60: 365, 90: 290, 120: 210 } as Record<number, number>,
  fat_mass: 17.5, rate_glycerol: 2.6, rate_palmitate: 1.9,
};

/** Example participant expressed in the chosen units (conversion via core toUnit). */
export function exampleState(units: UnitChoice = DEFAULT_UNITS, base?: FormState): FormState {
  const st = base ? { ...base, units: { ...units } } : emptyState(units);
  const { settings } = settingsOf(st);
  const c = (v: number, q: 'glucose' | 'insulin' | 'ffa' | 'tg' | 'hdl') =>
    clean(toUnit(v, q, CANONICAL[q], units[q], settings));
  const times = Object.keys(NGT_M.glucose).map(Number);
  return {
    ...st,
    rows: times.map((t) => ({ time: String(t), glucose: c(NGT_M.glucose[t]!, 'glucose'), insulin: c(NGT_M.insulin[t]!, 'insulin') })),
    tg: c(NGT_M.tg, 'tg'), hdl: c(NGT_M.hdl, 'hdl'), ffa: c(NGT_M.ffa, 'ffa'),
    age: String(NGT_M.age), sex: NGT_M.sex, weight: String(NGT_M.weight), bmi: String(NGT_M.bmi),
    waist: String(NGT_M.waist), height: '', fat_mass: String(NGT_M.fat_mass),
    rate_glycerol: String(NGT_M.rate_glycerol), rate_palmitate: String(NGT_M.rate_palmitate),
  };
}

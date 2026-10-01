import { toUnit, resolveSettings, type ConversionSettings } from '../units';
import type { Direction, Inputs, Result } from '../types';
import { bad, error, mk, unavailable } from './util';

export type Sex = 'male' | 'female';

export interface Conv {
  gmg: (mmol: number) => number; // glucose mmol/L -> mg/dL
  iu: (pmol: number) => number; // insulin pmol/L -> uU/mL
  tgmg: (mmol: number) => number;
  hdlmg: (mmol: number) => number;
}

export type Outcome = number | { value: number; details?: Record<string, unknown> };
export type Formula = (v: Record<string, number>, c: Conv, sex?: Sex) => Outcome;

const LABEL: Record<string, string> = {
  weight: 'body weight', bmi: 'BMI', waist: 'waist circumference', age: 'age',
  tg: 'triglycerides', hdl: 'HDL cholesterol', sex: 'sex (male/female)',
  fat_mass: 'fat mass (DXA)', rate_glycerol: 'glycerol rate of appearance', rate_palmitate: 'palmitate rate of appearance',
};
const SERIES: Record<string, 'glucose' | 'insulin' | 'ffa'> = { G: 'glucose', I: 'insulin', FFA: 'ffa' };
const SNAME: Record<string, string> = { glucose: 'glucose', insulin: 'insulin', ffa: 'FFA' };

function label(key: string): string {
  const m = /^(G|I|FFA)(\d+)$/.exec(key);
  if (!m) return LABEL[key] ?? key;
  const t = Number(m[2]);
  return `${t === 0 ? 'fasting' : `${t}-min`} ${SNAME[SERIES[m[1]!]!]}`;
}

/**
 * Generic runner. `needs` keys: G<t>, I<t>, FFA<t> (series at minute t) or
 * weight, bmi, waist, age, tg, hdl, sex. Missing -> unavailable; invalid (<=0, non-finite) -> error.
 */
export function run(
  id: string,
  dir: Direction,
  inputs: Inputs,
  settings: Partial<ConversionSettings> | undefined,
  needs: string[],
  fn: Formula,
): Result {
  const s = resolveSettings(settings);
  const vals: Record<string, number> = {};
  const missing: string[] = [];
  const errs: string[] = [];
  let sex: Sex | undefined;
  for (const k of needs) {
    if (k === 'sex') {
      if (inputs.sex === undefined) missing.push(`requires ${label(k)}`);
      else if (inputs.sex !== 'male' && inputs.sex !== 'female') errs.push('Sex must be male or female.');
      else sex = inputs.sex;
      continue;
    }
    const m = /^(G|I|FFA)(\d+)$/.exec(k);
    const v = m ? inputs[SERIES[m[1]!]!]?.[Number(m[2])] : (inputs as Record<string, unknown>)[k];
    if (v === undefined) missing.push(`requires ${label(k)}`);
    else if (typeof v !== 'number' || bad(v))
      errs.push(`${label(k)[0]!.toUpperCase()}${label(k).slice(1)} must be a finite value > 0 (got ${String(v)}).`);
    else vals[k] = v;
  }
  if (missing.length) return unavailable(id, dir, s, ...missing);
  if (errs.length) return error(id, dir, s, ...errs);
  const c: Conv = {
    gmg: (x) => toUnit(x, 'glucose', 'mmol/L', 'mg/dL', s),
    iu: (x) => toUnit(x, 'insulin', 'pmol/L', 'uU/mL', s),
    tgmg: (x) => toUnit(x, 'tg', 'mmol/L', 'mg/dL', s),
    hdlmg: (x) => toUnit(x, 'hdl', 'mmol/L', 'mg/dL', s),
  };
  const out = fn(vals, c, sex);
  const value = typeof out === 'number' ? out : out.value;
  if (!Number.isFinite(value))
    return error(id, dir, s, 'Result is not finite for these inputs (division by zero or log of a non-positive value).');
  return mk(id, dir, s, { status: 'ok', value, details: typeof out === 'number' ? undefined : out.details });
}

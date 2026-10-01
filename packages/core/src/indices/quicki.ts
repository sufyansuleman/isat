import { toUnit, resolveSettings, type ConversionSettings } from '../units';
import type { Inputs, Result } from '../types';
import { bad, error, mk, unavailable } from './util';

const ID = 'quicki';
const DIR = 'higher_more_sensitive' as const;

export function quicki(inputs: Inputs, settings?: Partial<ConversionSettings>): Result {
  const s = resolveSettings(settings);
  const g = inputs.glucose?.[0];
  const i = inputs.insulin?.[0];
  const missing: string[] = [];
  if (i === undefined) missing.push('requires fasting insulin');
  if (g === undefined) missing.push('requires fasting glucose');
  if (missing.length) return unavailable(ID, DIR, s, ...missing);
  const errs: string[] = [];
  if (bad(i)) errs.push('Fasting insulin must be a finite value > 0 (log10 is undefined otherwise).');
  if (bad(g)) errs.push('Fasting glucose must be a finite value > 0 (log10 is undefined otherwise).');
  if (errs.length) return error(ID, DIR, s, ...errs);
  const iU = toUnit(i!, 'insulin', 'pmol/L', 'uU/mL', s);
  const gMg = toUnit(g!, 'glucose', 'mmol/L', 'mg/dL', s);
  const denom = Math.log10(iU) + Math.log10(gMg);
  if (denom === 0 || !Number.isFinite(denom))
    return error(ID, DIR, s, 'log10(I0) + log10(G0) is zero; QUICKI is undefined.');
  return mk(ID, DIR, s, {
    status: 'ok',
    value: 1 / denom,
    details: { insulin_uU_per_mL: iU, glucose_mg_per_dL: gMg },
  });
}

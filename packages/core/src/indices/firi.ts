import { toUnit, resolveSettings, type ConversionSettings } from '../units';
import type { Inputs, Result } from '../types';
import { bad, error, mk, unavailable } from './util';

const ID = 'firi';
const DIR = 'higher_more_resistant' as const;

export function firi(inputs: Inputs, settings?: Partial<ConversionSettings>): Result {
  const s = resolveSettings(settings);
  const g = inputs.glucose?.[0];
  const i = inputs.insulin?.[0];
  const missing: string[] = [];
  if (i === undefined) missing.push('requires fasting insulin');
  if (g === undefined) missing.push('requires fasting glucose');
  if (missing.length) return unavailable(ID, DIR, s, ...missing);
  const errs: string[] = [];
  if (bad(i)) errs.push('Fasting insulin must be a finite value > 0.');
  if (bad(g)) errs.push('Fasting glucose must be a finite value > 0.');
  if (errs.length) return error(ID, DIR, s, ...errs);
  const iU = toUnit(i!, 'insulin', 'pmol/L', 'uU/mL', s);
  const gMmol = toUnit(g!, 'glucose', 'mmol/L', 'mmol/L', s);
  return mk(ID, DIR, s, { status: 'ok', value: (gMmol * iU) / 25 });
}

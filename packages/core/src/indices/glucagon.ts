import type { ConversionSettings } from '../units';
import type { Inputs, Result } from '../types';
import { run } from './engine';

type S = Partial<ConversionSettings> | undefined;
const D = 'descriptive' as const;

/** Fasting glucagon (pmol/L). */
export const glucagonFasting = (i: Inputs, s?: S): Result =>
  run('glucagon_fasting', D, i, s, ['GL0'], (v) => v.GL0!);

/** Trapezoid area under the glucagon curve over 0/30/120 min (pmol/L x min). */
export const glucagonAuc = (i: Inputs, s?: S): Result =>
  run('glucagon_auc', D, i, s, ['GL0', 'GL30', 'GL120'], (v) =>
    0.5 * ((v.GL30! + v.GL0!) * 30 + (v.GL120! + v.GL30!) * 90));

/** IsletCalc's Glucagon_suppression_ratio: glucagon at 120 min divided by fasting glucagon. */
export const glucagonRatio1200 = (i: Inputs, s?: S): Result =>
  run('glucagon_ratio_120_0', D, i, s, ['GL0', 'GL120'], (v) => v.GL120! / v.GL0!);

/** Chen 2021: (1 - glucagon at 60 min / fasting glucagon) x 100 (percent). */
export const glucagonSuppressionPct60 = (i: Inputs, s?: S): Result =>
  run('glucagon_suppression_pct_60', D, i, s, ['GL0', 'GL60'], (v) => (1 - v.GL60! / v.GL0!) * 100);

/** Fasting glucagon / fasting insulin, both pmol/L (molar ratio). */
export const glucagonInsulinRatio = (i: Inputs, s?: S): Result =>
  run('glucagon_insulin_ratio', D, i, s, ['GL0', 'I0'], (v) => v.GL0! / v.I0!);

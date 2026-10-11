import type { ConversionSettings } from '../units';
import type { Inputs, Result } from '../types';
import { run } from './engine';
import { matsuda3pt, bigttSi } from './ogtt';

type S = Partial<ConversionSettings> | undefined;
const D = 'descriptive' as const;
const mean = (...x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const KEYS3 = ['G0', 'G30', 'G120', 'I0', 'I30', 'I120'];

/** Matthews 1985 as in Madsen 2024 Supplementary Table 1: 20 x I0 (uU/mL) / (G0 - 3.5). */
export const homaBeta = (i: Inputs, s?: S): Result =>
  run('homa_beta', D, i, s, ['G0', 'I0'], (v, c) =>
    v.G0! <= 3.5
      ? { unavailable: 'not defined when fasting glucose is 3.5 mmol/L or lower' }
      : (20 * c.iu(v.I0!)) / (v.G0! - 3.5));

/** Sluiter 1976 / Madsen 2024: 100 x I30 (uU/mL) / (G30 x (G30 - 70)), glucose in mg/dL. */
export const cir30 = (i: Inputs, s?: S): Result =>
  run('cir30', D, i, s, ['G30', 'I30'], (v, c) => {
    const g = c.gmg(v.G30!);
    return g <= 70
      ? { unavailable: 'not defined when 30-min glucose is 70 mg/dL (3.9 mmol/L) or lower' }
      : (100 * c.iu(v.I30!)) / (g * (g - 70));
  });

/** Stumvoll 2000 first-phase estimate (insulin pmol/L, glucose mmol/L). */
export const stumvollFirstPhase = (i: Inputs, s?: S): Result =>
  run('stumvoll_first_phase', D, i, s, ['G30', 'I0', 'I30'], (v) =>
    1283 + 1.829 * v.I30! - 138.7 * v.G30! + 3.772 * v.I0!);

/** (I30 - I0) in uU/mL divided by (G30 - G0) in mg/dL. */
export const insulinogenicDg30 = (i: Inputs, s?: S): Result =>
  run('insulinogenic_dg30', D, i, s, ['G0', 'G30', 'I0', 'I30'], (v, c) =>
    v.G30! === v.G0!
      ? { unavailable: 'not defined when 30-min glucose equals fasting glucose' }
      : (c.iu(v.I30!) - c.iu(v.I0!)) / (c.gmg(v.G30!) - c.gmg(v.G0!)));

/** (I30 - I0) in uU/mL divided by G30 in mmol/L. */
export const insulinogenicG30 = (i: Inputs, s?: S): Result =>
  run('insulinogenic_g30', D, i, s, ['G30', 'I0', 'I30'], (v, c) =>
    (c.iu(v.I30!) - c.iu(v.I0!)) / v.G30!);

/** Madsen 2024 Supplementary Table 1 as printed: Xinsg30 x 1000 / ( sqrt(G0 x I0) x (meanG x meanI) ), mg/dL and uU/mL, means over 0/30/120. */
export const diMadsenTable = (i: Inputs, s?: S): Result =>
  run('di_madsen_table', D, i, s, KEYS3, (v, c) => {
    const g0 = c.gmg(v.G0!), i0 = c.iu(v.I0!);
    const mg = mean(c.gmg(v.G0!), c.gmg(v.G30!), c.gmg(v.G120!));
    const mi = mean(c.iu(v.I0!), c.iu(v.I30!), c.iu(v.I120!));
    const xins = (c.iu(v.I30!) - c.iu(v.I0!)) / v.G30!;
    return (xins * 1000) / (Math.sqrt(g0 * i0) * (mg * mi));
  });

/** Xinsg30 x Matsuda ISI (3-point, ISAT matsuda_3pt). */
export const diXinsg30Matsuda = (i: Inputs, s?: S): Result =>
  run('di_xinsg30_matsuda', D, i, s, KEYS3, (v, c) => {
    const m = matsuda3pt(i, s);
    if (m.status !== 'ok') return { unavailable: m.reasons.join('; ') || 'Matsuda ISI unavailable' };
    const xins = (c.iu(v.I30!) - c.iu(v.I0!)) / v.G30!;
    return { value: xins * (m.value as number), details: { matsuda_3pt: m.value, insulinogenic_g30: xins } };
  });

function bigttAirValue(v: Record<string, number>, sex: string | undefined): number {
  return Math.exp(
    8.2 + 0.00178 * v.I0! + 0.00168 * v.I30! - 0.000383 * v.I120! - 0.314 * v.G0! -
      0.109 * v.G30! + 0.0781 * v.G120! + 0.18 * (sex === 'male' ? 1 : 0) + 0.032 * v.bmi!,
  );
}
const BIGTT_KEYS = [...KEYS3, 'bmi', 'sex'];

/** Hansen 2007 BIGTT-AIR (acute insulin response); insulin pmol/L, glucose mmol/L, male = 1. */
export const bigttAir = (i: Inputs, s?: S): Result =>
  run('bigtt_air', D, i, s, BIGTT_KEYS, (v, _c, sex) => bigttAirValue(v, sex));

/** BIGTT-AIR x BIGTT-SI (Madsen 2024 DIBIG). */
export const diBigtt = (i: Inputs, s?: S): Result =>
  run('di_bigtt', D, i, s, BIGTT_KEYS, (v, _c, sex) => {
    const si = bigttSi(i, s);
    const air = bigttAirValue(v, sex);
    return { value: air * (si.value as number), details: { bigtt_air: air, bigtt_si: si.value } };
  });

import type { ConversionSettings } from '../units';
import type { Inputs, Result } from '../types';
import { run, type Conv } from './engine';

type S = Partial<ConversionSettings> | undefined;
const R = 'higher_more_resistant' as const;
const S_ = 'higher_more_sensitive' as const;
const mean = (...x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;

export const isi120 = (i: Inputs, s?: S): Result =>
  run('isi_120', S_, i, s, ['G120', 'I120'], (v, c) => 10000 / (c.gmg(v.G120!) * c.iu(v.I120!)));
export const igRatio120 = (i: Inputs, s?: S): Result =>
  run('ig_ratio_120', R, i, s, ['G120', 'I120'], (v, c) => c.iu(v.I120!) / v.G120!);

export const gutt = (i: Inputs, s?: S): Result =>
  run('gutt', S_, i, s, ['G0', 'G120', 'I0', 'I120', 'weight'], (v, c) => {
    // Gutt 2000: [(75000 + (G0 - G120)[mg/dL]*0.19*BW)/120] / MPG[mmol/L] / log10(MSI[uU/mL])
    const g0 = c.gmg(v.G0!), g120 = c.gmg(v.G120!);
    const mpg = mean(v.G0!, v.G120!), msi = mean(c.iu(v.I0!), c.iu(v.I120!));
    return {
      value: (75000 + (g0 - g120) * 0.19 * v.weight!) / 120 / mpg / Math.log10(msi),
      details: { mean_glucose_mmol_L: mpg, mean_insulin_uU_mL: msi, time_points: [0, 120] },
    };
  });

function matsuda(
  id: string, i: Inputs, s: S, times: number[],
  gm: (g: number[]) => number, im: (x: number[]) => number,
): Result {
  const keys = times.flatMap((t) => [`G${t}`, `I${t}`]);
  return run(id, S_, i, s, keys, (v, c: Conv) => {
    const g = times.map((t) => c.gmg(v[`G${t}`]!));
    const x = times.map((t) => c.iu(v[`I${t}`]!));
    const G = gm(g), I = im(x);
    return {
      value: 10000 / Math.sqrt(g[0]! * x[0]! * G * I),
      details: { mean_glucose_mg_dL: G, mean_insulin_uU_mL: I, time_points: times },
    };
  });
}
export const matsuda3pt = (i: Inputs, s?: S): Result =>
  matsuda('matsuda_3pt', i, s, [0, 30, 120], (a) => mean(...a), (a) => mean(...a));
const auc3 = (a: number[]) => (15 * a[0]! + 60 * a[1]! + 45 * a[2]!) / 120;
export const matsudaAuc3pt = (i: Inputs, s?: S): Result =>
  matsuda('matsuda_auc_3pt', i, s, [0, 30, 120], auc3, auc3);
export const matsuda5pt = (i: Inputs, s?: S): Result =>
  matsuda('matsuda_5pt', i, s, [0, 30, 60, 90, 120], (a) => mean(...a), (a) => mean(...a));

export const stumvollMod = (i: Inputs, s?: S): Result =>
  run('stumvoll_mod', S_, i, s, ['I0', 'I120', 'G120'], (v) =>
    0.156 - 0.0000459 * v.I120! - 0.000321 * v.I0! - 0.00541 * v.G120!);
export const stumvollDem = (i: Inputs, s?: S): Result =>
  run('stumvoll_dem', S_, i, s, ['I120', 'bmi', 'age'], (v) =>
    0.222 - 0.00333 * v.bmi! - 0.0000779 * v.I120! - 0.000422 * v.age!);

export const bigttSi = (i: Inputs, s?: S): Result =>
  run('bigtt_si', S_, i, s, ['G0', 'G30', 'G120', 'I0', 'I30', 'I120', 'bmi', 'sex'], (v, _c, sex) =>
    Math.exp(
      4.9 - 0.00402 * v.I0! - 0.000556 * v.I30! - 0.00127 * v.I120! - 0.152 * v.G0! -
        0.00871 * v.G30! - 0.0373 * v.G120! - 0.145 * (sex === 'male' ? 1 : 0) - 0.0376 * v.bmi!,
    ));

export const avignonSi0 = (i: Inputs, s?: S): Result =>
  run('avignon_si0', S_, i, s, ['G0', 'I0', 'weight'], (v, c) =>
    1e8 / (c.gmg(v.G0!) * c.iu(v.I0!) * v.weight! * 150));
export const avignonSi120 = (i: Inputs, s?: S): Result =>
  run('avignon_si120', S_, i, s, ['G120', 'I120', 'weight'], (v, c) =>
    1e8 / (c.gmg(v.G120!) * c.iu(v.I120!) * v.weight! * 150));

export const AVIGNON_1999_WEIGHT = 0.137;
export type AvignonWeightSource = 'sample' | 'avignon_1999' | 'user';

/** Avignon Sim = (w*Si0 + Si120)/2. Weight and its source are always recorded in details. */
export function avignonSim(
  i: Inputs, s: S | undefined, w: number = AVIGNON_1999_WEIGHT,
  source: AvignonWeightSource = 'avignon_1999', warnings: string[] = [],
): Result {
  const a = avignonSi0(i, s), b = avignonSi120(i, s);
  if (a.status !== 'ok' || b.status !== 'ok') {
    const bad = a.status === 'error' || b.status === 'error' ? (a.status === 'error' ? a : b) : a.status !== 'ok' ? a : b;
    const reasons = [...new Set([...a.reasons, ...b.reasons])];
    return { ...bad, id: 'avignon_sim', reasons, warnings: [...warnings] };
  }
  const si0 = a.value as number, si120 = b.value as number;
  return {
    ...a, id: 'avignon_sim', value: (w * si0 + si120) / 2, warnings: [...warnings],
    details: { weight: w, weight_source: source, si0, si120 },
  };
}

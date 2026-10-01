import { toUnit, type ConversionSettings } from '../units';
import type { Inputs, Result } from '../types';
import { run } from './engine';

type S = Partial<ConversionSettings> | undefined;
const R = 'higher_more_resistant' as const;
const S_ = 'higher_more_sensitive' as const;

export const homaIr = (i: Inputs, s?: S): Result =>
  run('homa_ir', R, i, s, ['G0', 'I0'], (v, c) => (v.G0! * c.iu(v.I0!)) / 22.5);
export const raynaud = (i: Inputs, s?: S): Result =>
  run('raynaud', S_, i, s, ['I0'], (v, c) => 40 / c.iu(v.I0!));
export const isiBasal = (i: Inputs, s?: S): Result =>
  run('isi_basal', S_, i, s, ['G0', 'I0'], (v, c) => 10000 / (c.gmg(v.G0!) * c.iu(v.I0!)));
export const igRatioBasal = (i: Inputs, s?: S): Result =>
  run('ig_ratio_basal', R, i, s, ['G0', 'I0'], (v, c) => c.iu(v.I0!) / v.G0!);

const mean = (...x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const TRACER = 'tracer rate units as supplied by user';

export const bennett = (i: Inputs, s?: S): Result =>
  run('bennett', S_, i, s, ['G0', 'I0'], (v, c) => 1 / (Math.log(c.iu(v.I0!)) * Math.log(c.gmg(v.G0!))));
export const hiri = (i: Inputs, s?: S): Result =>
  run('hiri', R, i, s, ['G0', 'G30', 'I0', 'I30'], (v, c) => ({
    value: (mean(c.gmg(v.G0!), c.gmg(v.G30!)) / 100) * mean(c.iu(v.I0!), c.iu(v.I30!)),
    details: { time_points: [0, 30] },
  }));
export const ifc = (i: Inputs, s?: S): Result =>
  run('ifc', R, i, s, ['I0', 'I120'], (v) => Math.log(v.I120! / v.I0!));
export const liri = (i: Inputs, s?: S): Result =>
  run('liri', R, i, s, ['I0', 'I30', 'fat_mass', 'weight', 'hdl', 'bmi'], (v, c) => {
    // mean insulin in pmol/L via the units module (uU/mL mean x configured factor)
    const iPmol = toUnit(mean(c.iu(v.I0!), c.iu(v.I30!)), 'insulin', 'uU/mL', 'pmol/L', s);
    return (
      -0.091 + 0.4 * Math.log10(iPmol) + 0.346 * Math.log10((v.fat_mass! / v.weight!) * 100) -
      0.408 * Math.log10(c.hdlmg(v.hdl!)) + 0.435 * Math.log10(v.bmi!)
    );
  });
export const lipo = (i: Inputs, s?: S): Result =>
  run('lipo', R, i, s, ['rate_glycerol', 'I0'], (v, c) => ({ value: v.rate_glycerol! * c.iu(v.I0!), details: { note: TRACER } }));
export const atiri = (i: Inputs, s?: S): Result =>
  run('atiri', R, i, s, ['rate_palmitate', 'I0'], (v, c) => ({ value: v.rate_palmitate! * c.iu(v.I0!), details: { note: TRACER } }));

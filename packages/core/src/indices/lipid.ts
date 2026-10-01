import type { ConversionSettings } from '../units';
import type { Inputs, Result } from '../types';
import { run } from './engine';

type S = Partial<ConversionSettings> | undefined;
const R = 'higher_more_resistant' as const;
const S_ = 'higher_more_sensitive' as const;

export const revisedQuicki = (i: Inputs, s?: S): Result =>
  run('revised_quicki', S_, i, s, ['G0', 'I0', 'FFA0'], (v, c) =>
    1 / (Math.log10(c.iu(v.I0!)) + Math.log10(c.gmg(v.G0!)) + Math.log10(v.FFA0!)));
export const mcauley = (i: Inputs, s?: S): Result =>
  run('mcauley', S_, i, s, ['I0', 'tg'], (v, c) =>
    Math.exp(2.63 - 0.28 * Math.log(c.iu(v.I0!)) - 0.31 * Math.log(v.tg!)));
export const tyg = (i: Inputs, s?: S): Result =>
  run('tyg', R, i, s, ['tg', 'G0'], (v, c) => Math.log((c.tgmg(v.tg!) * c.gmg(v.G0!)) / 2));
export const tgHdl = (i: Inputs, s?: S): Result =>
  run('tg_hdl', R, i, s, ['tg', 'hdl'], (v, c) => c.tgmg(v.tg!) / c.hdlmg(v.hdl!));
export const vai = (i: Inputs, s?: S): Result =>
  run('vai', R, i, s, ['waist', 'bmi', 'tg', 'hdl', 'sex'], (v, _c, sex) =>
    sex === 'male'
      ? (v.waist! / (39.68 + 1.88 * v.bmi!)) * (v.tg! / 1.03) * (1.31 / v.hdl!)
      : (v.waist! / (36.58 + 1.89 * v.bmi!)) * (v.tg! / 0.81) * (1.52 / v.hdl!));
export const lap = (i: Inputs, s?: S): Result =>
  run('lap', R, i, s, ['waist', 'tg', 'sex'], (v, _c, sex) => (v.waist! - (sex === 'male' ? 65 : 58)) * v.tg!);
export const adipoIr = (i: Inputs, s?: S): Result =>
  run('adipo_ir', R, i, s, ['FFA0', 'I0'], (v, c) => v.FFA0! * c.iu(v.I0!));

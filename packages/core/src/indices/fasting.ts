import type { ConversionSettings } from '../units';
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

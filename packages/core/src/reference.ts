import { toUnit } from './units';
import type { Reference } from './types';

const f = (v: number) => toUnit(v, 'ffa', 'umol/L', 'mmol/L');

/**
 * Belfiore 1998 normal-population reference means, canonical units (areas in unit*h).
 * Transcribed from the paper (user-supplied 2026-10-01); NOT yet verified against the PDF.
 */
export const BELFIORE_1998: Reference = {
  name: 'belfiore_1998',
  insulin_0: 65.71,
  glucose_0: 5.08,
  ffa_0: f(398.88),
  insulin_area_0_2h: 363.04,
  glucose_area_0_2h: 10.26,
  ffa_area_0_2h: f(478.0),
  insulin_area_0_1_2h: 638.0,
  glucose_area_0_1_2h: 11.36,
  ffa_area_0_1_2h: f(296.25),
};

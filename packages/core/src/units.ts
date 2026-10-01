export type Quantity = 'glucose' | 'insulin' | 'ffa' | 'tg' | 'hdl';
export type Unit = 'mmol/L' | 'mg/dL' | 'pmol/L' | 'uU/mL' | 'mU/L' | 'umol/L';

export interface ConversionSettings {
  glucose_mg_per_dL_per_mmol: number;
  insulin_pmol_per_uU: number;
  tg_mg_per_dL_per_mmol: number;
  hdl_mg_per_dL_per_mmol: number;
}

export const DEFAULT_SETTINGS: ConversionSettings = {
  glucose_mg_per_dL_per_mmol: 18,
  insulin_pmol_per_uU: 6.0,
  tg_mg_per_dL_per_mmol: 88.57,
  hdl_mg_per_dL_per_mmol: 38.67,
};

export function resolveSettings(s?: Partial<ConversionSettings>): ConversionSettings {
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}

/** Canonical internal units: glucose mmol/L, insulin pmol/L, FFA mmol/L. */
export const CANONICAL: Record<Quantity, Unit> = {
  glucose: 'mmol/L',
  insulin: 'pmol/L',
  ffa: 'mmol/L',
  tg: 'mmol/L',
  hdl: 'mmol/L',
};

const SUPPORTED: Record<Quantity, Unit[]> = {
  glucose: ['mmol/L', 'mg/dL'],
  insulin: ['pmol/L', 'uU/mL', 'mU/L'],
  ffa: ['mmol/L', 'umol/L'],
  tg: ['mmol/L', 'mg/dL'],
  hdl: ['mmol/L', 'mg/dL'],
};

/** Factor such that value_in_unit = value_in_canonical * factor. */
function factor(q: Quantity, u: Unit, s: ConversionSettings): number {
  if (!SUPPORTED[q].includes(u)) throw new Error(`Unit ${u} is not supported for ${q}`);
  if (q === 'glucose') return u === 'mg/dL' ? s.glucose_mg_per_dL_per_mmol : 1;
  if (q === 'insulin') return u === 'pmol/L' ? 1 : 1 / s.insulin_pmol_per_uU;
  if (q === 'ffa') return u === 'umol/L' ? 1000 : 1;
  if (q === 'tg') return u === 'mg/dL' ? s.tg_mg_per_dL_per_mmol : 1;
  return u === 'mg/dL' ? s.hdl_mg_per_dL_per_mmol : 1;
}

/** The only place unit conversion happens. */
export function toUnit(
  value: number,
  quantity: Quantity,
  from: Unit,
  to: Unit,
  settings: Partial<ConversionSettings> = DEFAULT_SETTINGS,
): number {
  const s = resolveSettings(settings);
  const ff = factor(quantity, from, s);
  const ft = factor(quantity, to, s);
  if (ff === ft) return value;
  return (value / ff) * ft;
}

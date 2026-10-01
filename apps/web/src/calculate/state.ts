import { CANONICAL, DEFAULT_SETTINGS, toUnit, type ConversionSettings, type Inputs, type Series, type Unit } from '@isat/core';

export type GlucoseUnit = 'mmol/L' | 'mg/dL';
export type InsulinUnit = 'pmol/L' | 'uU/mL';
export type FfaUnit = 'mmol/L' | 'umol/L';
export type MassUnit = 'mmol/L' | 'mg/dL';

export interface UnitChoice { glucose: GlucoseUnit; insulin: InsulinUnit; tg: MassUnit; hdl: MassUnit; ffa: FfaUnit }
export interface Row { time: string; glucose: string; insulin: string }

export interface FormState {
  units: UnitChoice;
  insulinFactor: string; // pmol/L per uU/mL
  glucoseFactor: string; // mg/dL per mmol/L
  rows: Row[];
  tg: string; hdl: string; ffa: string;
  age: string; sex: '' | 'male' | 'female';
  weight: string; bmi: string; waist: string; height: string;
  fat_mass: string; rate_glycerol: string; rate_palmitate: string;
}

export const DEFAULT_UNITS: UnitChoice = { glucose: 'mmol/L', insulin: 'pmol/L', tg: 'mmol/L', hdl: 'mmol/L', ffa: 'mmol/L' };

export function emptyState(units: UnitChoice = DEFAULT_UNITS): FormState {
  return {
    units: { ...units },
    insulinFactor: String(DEFAULT_SETTINGS.insulin_pmol_per_uU),
    glucoseFactor: String(DEFAULT_SETTINGS.glucose_mg_per_dL_per_mmol),
    rows: [0, 30, 60, 90, 120].map((t) => ({ time: String(t), glucose: '', insulin: '' })),
    tg: '', hdl: '', ffa: '', age: '', sex: '', weight: '', bmi: '', waist: '', height: '',
    fat_mass: '', rate_glycerol: '', rate_palmitate: '',
  };
}

export type Parsed = { value?: number; error?: string };

/** Empty -> missing (never 0). Decimal comma and other non-numeric text are rejected. */
export function parseNumber(raw: string): Parsed {
  const s = raw.trim();
  if (s === '') return {};
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return { value: Number(s) };
  if (s.includes(',')) return { error: 'use a decimal point' };
  return { error: 'not a number' };
}

export interface Built {
  inputs: Inputs;
  settings: Partial<ConversionSettings>;
  /** Field key -> message. Keys: "tg", "row:2:glucose", ... */
  errors: Record<string, string>;
  bmiFromHeight?: number;
}

export function settingsOf(st: FormState): { settings: Partial<ConversionSettings>; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const settings: Partial<ConversionSettings> = {};
  const g = parseNumber(st.glucoseFactor), i = parseNumber(st.insulinFactor);
  if (g.value !== undefined && g.value > 0) settings.glucose_mg_per_dL_per_mmol = g.value;
  else errors['glucoseFactor'] = g.error ?? 'a positive factor is required';
  if (i.value !== undefined && i.value > 0) settings.insulin_pmol_per_uU = i.value;
  else errors['insulinFactor'] = i.error ?? 'a positive factor is required';
  return { settings, errors };
}

/** Form state -> canonical-unit Inputs. All unit conversion goes through core toUnit. */
export function buildInputs(st: FormState): Built {
  const { settings, errors } = settingsOf(st);
  const conv = (v: number, q: 'glucose' | 'insulin' | 'ffa' | 'tg' | 'hdl', from: Unit) =>
    toUnit(v, q, from, CANONICAL[q], settings);
  const inputs: Inputs = {};
  const num = (key: string, raw: string): number | undefined => {
    const p = parseNumber(raw);
    if (p.error) errors[key] = p.error;
    return p.value;
  };

  const glucose: Series = {}, insulin: Series = {};
  const seen = new Set<number>();
  st.rows.forEach((r, k) => {
    const t = num(`row:${k}:time`, r.time);
    const g = num(`row:${k}:glucose`, r.glucose);
    const i = num(`row:${k}:insulin`, r.insulin);
    if (t === undefined) {
      if (!errors[`row:${k}:time`] && (g !== undefined || i !== undefined)) errors[`row:${k}:time`] = 'time is required';
      return;
    }
    if (seen.has(t)) { errors[`row:${k}:time`] = 'duplicate time'; return; }
    seen.add(t);
    if (g !== undefined) glucose[t] = conv(g, 'glucose', st.units.glucose);
    if (i !== undefined) insulin[t] = conv(i, 'insulin', st.units.insulin);
  });
  if (Object.keys(glucose).length) inputs.glucose = glucose;
  if (Object.keys(insulin).length) inputs.insulin = insulin;

  const ffa = num('ffa', st.ffa); if (ffa !== undefined) inputs.ffa = { 0: conv(ffa, 'ffa', st.units.ffa) };
  const tg = num('tg', st.tg); if (tg !== undefined) inputs.tg = conv(tg, 'tg', st.units.tg);
  const hdl = num('hdl', st.hdl); if (hdl !== undefined) inputs.hdl = conv(hdl, 'hdl', st.units.hdl);
  for (const k of ['age', 'weight', 'bmi', 'waist', 'fat_mass', 'rate_glycerol', 'rate_palmitate'] as const) {
    const v = num(k, st[k]); if (v !== undefined) inputs[k] = v;
  }
  const height = num('height', st.height);
  if (st.sex) inputs.sex = st.sex;

  let bmiFromHeight: number | undefined;
  if (inputs.bmi === undefined && inputs.weight !== undefined && height !== undefined && height > 0 && inputs.weight > 0) {
    bmiFromHeight = inputs.weight / ((height / 100) * (height / 100));
    inputs.bmi = bmiFromHeight;
  }
  return { inputs, settings, errors, bmiFromHeight };
}

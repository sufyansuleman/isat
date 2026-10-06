import { toUnit, CANONICAL, DEFAULT_SETTINGS, type Unit } from '@isat/core';
import type { UnitChoice } from './state';

/**
 * Example values shown as grey placeholders ("e.g. …") in empty fields: a typical healthy adult
 * with normal glucose tolerance. They are hints only and are never used in a calculation.
 * Stored in canonical units (glucose, lipids, FFA mmol/L; insulin pmol/L) and converted for display.
 */
export const EXAMPLE_GLUCOSE: Record<number, number> = { 0: 5.0, 30: 7.8, 60: 7.0, 90: 6.2, 120: 5.6 };
export const EXAMPLE_INSULIN: Record<number, number> = { 0: 42, 30: 300, 60: 360, 90: 280, 120: 200 };
export const EXAMPLE_FIELDS: Record<string, number> = {
  tg: 1.0, hdl: 1.4, ffa: 0.45, age: 45, weight: 75, height: 175, bmi: 24.5, waist: 85, fat_mass: 18,
};

type Q = 'glucose' | 'insulin' | 'tg' | 'hdl' | 'ffa';
const DECIMALS: Record<string, number> = {
  'glucose:mmol/L': 1, 'glucose:mg/dL': 0, 'insulin:pmol/L': 0, 'insulin:uU/mL': 0, 'insulin:mU/L': 0,
  'tg:mmol/L': 1, 'tg:mg/dL': 0, 'hdl:mmol/L': 1, 'hdl:mg/dL': 0, 'ffa:mmol/L': 2, 'ffa:umol/L': 0,
};

function shown(value: number, q: Q, unit: Unit): string {
  const v = unit === CANONICAL[q] ? value : toUnit(value, q, CANONICAL[q], unit, DEFAULT_SETTINGS);
  return `e.g. ${v.toFixed(DECIMALS[`${q}:${unit}`] ?? 1)}`;
}

/** Placeholder for an OGTT table cell; rows at non-standard times keep the plain dash. */
export function seriesHint(q: 'glucose' | 'insulin', time: number, units: UnitChoice): string {
  const v = (q === 'glucose' ? EXAMPLE_GLUCOSE : EXAMPLE_INSULIN)[time];
  return v === undefined ? '-' : shown(v, q, units[q] as Unit);
}

/** Placeholder for a single field (lipids and body measures). Tracer rates get no example. */
export function fieldHint(key: string, units: UnitChoice): string {
  const v = EXAMPLE_FIELDS[key];
  if (v === undefined) return '-';
  if (key === 'tg' || key === 'hdl' || key === 'ffa') return shown(v, key, units[key] as Unit);
  return `e.g. ${v}`;
}

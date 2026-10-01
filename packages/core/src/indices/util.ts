import type { ConversionSettings } from '../units';
import type { Direction, Result, Series } from '../types';

export const bad = (v: number | undefined): boolean =>
  v === undefined || typeof v !== 'number' || !Number.isFinite(v) || v <= 0;

export function mk(
  id: string,
  direction: Direction,
  conversion: ConversionSettings,
  p: Partial<Result>,
): Result {
  return { id, direction, conversion, value: null, status: 'unavailable', reasons: [], warnings: [], ...p };
}

export const unavailable = (id: string, d: Direction, c: ConversionSettings, ...reasons: string[]) =>
  mk(id, d, c, { status: 'unavailable', reasons });

export const error = (id: string, d: Direction, c: ConversionSettings, ...reasons: string[]) =>
  mk(id, d, c, { status: 'error', reasons });

/** Value present (not undefined). Validity is checked separately. */
export const has = (s: Series | undefined, t: number): boolean => s?.[t] !== undefined;

/** Belfiore area in unit*h from 0/60/120 min values. */
export function area(s: Series, variant: '0_1_2h' | '0_2h'): number {
  const v0 = s[0] as number;
  const v120 = s[120] as number;
  return variant === '0_1_2h' ? 0.5 * v0 + (s[60] as number) + 0.5 * v120 : v0 + v120;
}

import type { Inputs, Series } from '@isat/core';
import { unitLabel } from '../calculate/results';
import type { UnitChoice } from '../calculate/state';

export type CheckQuantity = 'glucose' | 'insulin' | 'tg' | 'hdl' | 'ffa';

export interface UnitCheckItem {
  quantity: CheckQuantity;
  column: string;
  median: number;
  n: number;
  selected: string;
  /** Unit option value (as in the selects) the median points to, or null when no clear suggestion or it matches. */
  suggested: string | null;
}

export const MIN_VALUES = 5;

const QUANTITY_LABEL: Record<CheckQuantity, string> = { glucose: 'Fasting glucose', insulin: 'Fasting insulin', tg: 'TG', hdl: 'HDL', ffa: 'FFA' };

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const numbers = (xs: Array<number | undefined>): number[] => xs.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

const seriesAt = (rows: Inputs[], key: 'glucose' | 'insulin' | 'ffa', t: number): number[] =>
  numbers(rows.map((r) => (r[key] as Series | undefined)?.[t]));

/** Time point to check: fasting if it has enough values, else 120, else any other time point. */
function pickTime(rows: Inputs[], key: 'glucose' | 'ffa'): { t: number; v: number[] } | undefined {
  const times = new Set<number>();
  for (const r of rows) for (const k of Object.keys((r[key] as Series | undefined) ?? {})) times.add(Number(k));
  const order = [0, 120, ...[...times].filter((t) => t !== 0 && t !== 120).sort((a, b) => a - b)];
  for (const t of order) {
    const v = seriesAt(rows, key, t);
    if (v.length >= MIN_VALUES) return { t, v };
  }
  return undefined;
}

/** Plausibility check of the selected units against the median of raw file values. Pure; never changes anything. */
export function checkUnits(rows: Inputs[], units: UnitChoice): UnitCheckItem[] {
  const out: UnitCheckItem[] = [];
  const add = (quantity: CheckQuantity, column: string, v: number[], selected: string, suggest: (m: number) => string | null) => {
    if (v.length < MIN_VALUES) return;
    const m = median(v);
    const s = suggest(m);
    out.push({ quantity, column, median: m, n: v.length, selected, suggested: s !== null && s !== selected ? s : null });
  };

  const g = pickTime(rows, 'glucose');
  if (g) add('glucose', `G${g.t}`, g.v, units.glucose, (m) => (m < 25 ? 'mmol/L' : m > 30 ? 'mg/dL' : null));

  const sel = units.insulin as string;
  add('insulin', 'I0', seriesAt(rows, 'insulin', 0), sel, (m) => {
    const s = m > 40 ? 'pmol/L' : m < 25 ? 'uU/mL' : null;
    return s === 'uU/mL' && sel === 'mU/L' ? sel : s; // mU/L is the same unit as uU/mL
  });

  add('tg', 'TG', numbers(rows.map((r) => r.tg)), units.tg, (m) => (m < 8 ? 'mmol/L' : m > 15 ? 'mg/dL' : null));
  add('hdl', 'HDL_c', numbers(rows.map((r) => r.hdl)), units.hdl, (m) => (m < 4 ? 'mmol/L' : m > 10 ? 'mg/dL' : null));

  const f = pickTime(rows, 'ffa');
  if (f) add('ffa', f.t === 0 ? 'FFA' : `FFA${f.t}`, f.v, units.ffa, (m) => (m < 5 ? 'mmol/L' : m > 20 ? 'umol/L' : null));
  return out;
}

/** Rounded for display (3 significant figures). */
export const fmtMedian = (x: number): string => String(Number(x.toPrecision(3)));

export function warningText(i: UnitCheckItem): string {
  return `⚠ ${QUANTITY_LABEL[i.quantity]}: median ${fmtMedian(i.median)} looks like ${unitLabel(i.suggested!)}, but ${unitLabel(i.selected)} is selected.`;
}

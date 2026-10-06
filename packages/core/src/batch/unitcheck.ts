import type { Inputs, Series } from '../types';
import type { UnitChoice } from './parse';

export const unitLabel = (u: string) => u.replace('uU/mL', 'µU/mL').replace('umol/L', 'µmol/L');

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

type SeriesKey = 'glucose' | 'insulin' | 'ffa';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Gathers the numbers the plausibility check needs, row by row (no rows are kept). */
export class UnitCheckCollector {
  private readonly s: Record<SeriesKey, Map<number, number[]>> = { glucose: new Map(), insulin: new Map(), ffa: new Map() };
  private readonly tg: number[] = [];
  private readonly hdl: number[] = [];

  /** Row in the units used in the file. */
  add(r: Inputs): void {
    for (const key of ['glucose', 'insulin', 'ffa'] as const) {
      const x = r[key] as Series | undefined;
      if (!x) continue;
      for (const [k, v] of Object.entries(x)) {
        if (!isNum(v)) continue;
        const t = Number(k);
        if (key === 'insulin' && t !== 0) continue; // only fasting insulin is checked
        const m = this.s[key];
        const a = m.get(t);
        if (a) a.push(v); else m.set(t, [v]);
      }
    }
    if (isNum(r.tg)) this.tg.push(r.tg);
    if (isNum(r.hdl)) this.hdl.push(r.hdl);
  }

  /** Time point to check: fasting if it has enough values, else 120, else any other time point. */
  private pickTime(key: 'glucose' | 'ffa'): { t: number; v: number[] } | undefined {
    const m = this.s[key];
    const order = [0, 120, ...[...m.keys()].filter((t) => t !== 0 && t !== 120).sort((a, b) => a - b)];
    for (const t of order) {
      const v = m.get(t) ?? [];
      if (v.length >= MIN_VALUES) return { t, v };
    }
    return undefined;
  }

  finish(units: UnitChoice): UnitCheckItem[] {
    const out: UnitCheckItem[] = [];
    const add = (quantity: CheckQuantity, column: string, v: number[], selected: string, suggest: (m: number) => string | null) => {
      if (v.length < MIN_VALUES) return;
      const m = median(v);
      const s = suggest(m);
      out.push({ quantity, column, median: m, n: v.length, selected, suggested: s !== null && s !== selected ? s : null });
    };

    const g = this.pickTime('glucose');
    if (g) add('glucose', `G${g.t}`, g.v, units.glucose, (m) => (m < 25 ? 'mmol/L' : m > 30 ? 'mg/dL' : null));

    const sel = units.insulin as string;
    add('insulin', 'I0', this.s.insulin.get(0) ?? [], sel, (m) => {
      const s = m > 40 ? 'pmol/L' : m < 25 ? 'uU/mL' : null;
      return s === 'uU/mL' && sel === 'mU/L' ? sel : s; // mU/L is the same unit as uU/mL
    });

    add('tg', 'TG', this.tg, units.tg, (m) => (m < 8 ? 'mmol/L' : m > 15 ? 'mg/dL' : null));
    add('hdl', 'HDL_c', this.hdl, units.hdl, (m) => (m < 4 ? 'mmol/L' : m > 10 ? 'mg/dL' : null));

    const f = this.pickTime('ffa');
    if (f) add('ffa', f.t === 0 ? 'FFA' : `FFA${f.t}`, f.v, units.ffa, (m) => (m < 5 ? 'mmol/L' : m > 20 ? 'umol/L' : null));
    return out;
  }
}

/** Plausibility check of the selected units against the median of raw file values. Pure; never changes anything. */
export function checkUnits(rows: Inputs[], units: UnitChoice): UnitCheckItem[] {
  const c = new UnitCheckCollector();
  for (const r of rows) c.add(r);
  return c.finish(units);
}

/** Rounded for display (3 significant figures). */
export const fmtMedian = (x: number): string => String(Number(x.toPrecision(3)));

export function warningText(i: UnitCheckItem): string {
  return `⚠ ${QUANTITY_LABEL[i.quantity]}: median ${fmtMedian(i.median)} looks like ${unitLabel(i.suggested!)}, but ${unitLabel(i.selected)} is selected.`;
}

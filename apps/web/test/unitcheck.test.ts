// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import type { Inputs } from '@isat/core';
import { DEFAULT_UNITS, type UnitChoice } from '../src/calculate/state';
import { checkUnits } from '../src/upload/unitcheck';
import { mountUpload } from '../src/upload/view';

const rows = (n: number, mk: (k: number) => Inputs): Inputs[] => Array.from({ length: n }, (_, k) => mk(k));
const sug = (r: Inputs[], u: Partial<UnitChoice> = {}, q = 'glucose') =>
  checkUnits(r, { ...DEFAULT_UNITS, ...u }).find((i) => i.quantity === q)?.suggested;

describe('unit plausibility thresholds', () => {
  it('glucose', () => {
    const g = (m: number) => rows(6, () => ({ glucose: { 0: m } }));
    expect(sug(g(95))).toBe('mg/dL');
    expect(sug(g(5))).toBeNull(); // already mmol/L
    expect(sug(g(5), { glucose: 'mg/dL' })).toBe('mmol/L');
    expect(sug(g(24.9), { glucose: 'mg/dL' })).toBe('mmol/L');
    for (const m of [25, 27, 30]) expect(sug(g(m))).toBeNull();
    expect(sug(g(30.1))).toBe('mg/dL');
  });
  it('glucose column choice: G0, else G120', () => {
    const r = rows(6, () => ({ glucose: { 120: 95 } }));
    const i = checkUnits(r, DEFAULT_UNITS).find((x) => x.quantity === 'glucose')!;
    expect(i.column).toBe('G120');
    const r2 = rows(6, () => ({ glucose: { 0: 5, 120: 95 } }));
    expect(checkUnits(r2, DEFAULT_UNITS).find((x) => x.quantity === 'glucose')!.column).toBe('G0');
  });
  it('insulin uses fasting only; ambiguous zone 25-40', () => {
    const ins = (m: number) => rows(6, () => ({ insulin: { 0: m } }));
    expect(sug(ins(60), {}, 'insulin')).toBeNull(); // pmol/L selected
    expect(sug(ins(60), { insulin: 'uU/mL' }, 'insulin')).toBe('pmol/L');
    expect(sug(ins(10), {}, 'insulin')).toBe('uU/mL');
    for (const m of [25, 30, 40]) expect(sug(ins(m), {}, 'insulin')).toBeNull();
    expect(checkUnits(rows(6, () => ({ insulin: { 30: 10 } })), DEFAULT_UNITS).some((i) => i.quantity === 'insulin')).toBe(false);
  });
  it('mU/L is treated as uU/mL', () => {
    const u = { insulin: 'mU/L' } as unknown as Partial<UnitChoice>;
    expect(sug(rows(6, () => ({ insulin: { 0: 10 } })), u, 'insulin')).toBeNull();
    expect(sug(rows(6, () => ({ insulin: { 0: 60 } })), u, 'insulin')).toBe('pmol/L');
  });
  it('TG, HDL, FFA', () => {
    const tg = (m: number) => rows(6, () => ({ tg: m }));
    expect(sug(tg(100), {}, 'tg')).toBe('mg/dL');
    expect(sug(tg(1.2), { tg: 'mg/dL' }, 'tg')).toBe('mmol/L');
    for (const m of [8, 12, 15]) expect(sug(tg(m), {}, 'tg')).toBeNull();
    const hdl = (m: number) => rows(6, () => ({ hdl: m }));
    expect(sug(hdl(50), {}, 'hdl')).toBe('mg/dL');
    expect(sug(hdl(1.3), { hdl: 'mg/dL' }, 'hdl')).toBe('mmol/L');
    for (const m of [4, 7, 10]) expect(sug(hdl(m), {}, 'hdl')).toBeNull();
    const ffa = (m: number) => rows(6, () => ({ ffa: { 0: m } }));
    expect(sug(ffa(500), {}, 'ffa')).toBe('umol/L');
    expect(sug(ffa(0.5), { ffa: 'umol/L' }, 'ffa')).toBe('mmol/L');
    for (const m of [5, 10, 20]) expect(sug(ffa(m), {}, 'ffa')).toBeNull();
  });
  it('needs at least 5 values; records n and median', () => {
    expect(checkUnits(rows(4, () => ({ glucose: { 0: 95 } })), DEFAULT_UNITS)).toEqual([]);
    const r = [...rows(5, (k) => ({ glucose: { 0: 90 + k } })), {}, { glucose: { 0: undefined } }];
    const i = checkUnits(r, DEFAULT_UNITS)[0]!;
    expect(i).toMatchObject({ quantity: 'glucose', column: 'G0', median: 92, n: 5, selected: 'mmol/L', suggested: 'mg/dL' });
  });
});

describe('unit check UI', () => {
  const csv = 'id,fasting_glucose,fasting_insulin\n' + Array.from({ length: 6 }, (_, k) => `p${k},${90 + k},${8 + k}`).join('\n');
  async function mount() {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountUpload(root);
    const input = root.querySelector('#up-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File([csv], 'x.csv', { type: 'text/csv' })] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    for (let k = 0; k < 50 && root.querySelector('#up-loaded')!.hasAttribute('hidden'); k++) await new Promise((r) => setTimeout(r, 20));
    return root;
  }
  it('warns, switches on click, and the warning disappears', async () => {
    const root = await mount();
    const area = root.querySelector('#up-unitcheck')!;
    expect(area.getAttribute('role')).toBe('status');
    expect(area.textContent).toContain('⚠ Fasting glucose: median 92.5 looks like mg/dL, but mmol/L is selected.');
    expect(area.textContent).toContain('Fasting insulin: median 10.5 looks like µU/mL, but pmol/L is selected.');
    (area.querySelector('button[data-uc="glucose"]') as HTMLButtonElement).click();
    expect((root.querySelector('#u-u-glucose') as HTMLSelectElement).value).toBe('mg/dL');
    expect(area.textContent).not.toContain('Fasting glucose');
    expect(area.textContent).toContain('Fasting insulin');
    // manual change re-evaluates
    const g = root.querySelector('#u-u-glucose') as HTMLSelectElement;
    g.value = 'mmol/L'; g.dispatchEvent(new Event('change', { bubbles: true }));
    expect(area.textContent).toContain('Fasting glucose');
  });
  it('places the units section before the column mapping', async () => {
    const root = await mount();
    const units = root.querySelector('#up-units')!;
    const map = root.querySelector('.map-details')!;
    expect(units.querySelector('h2')!.textContent).toBe('Units used in your file');
    expect(units.compareDocumentPosition(map) & 4).toBeTruthy(); // map follows units
    expect(root.querySelector('#up-file2, #up-h-file2')!.compareDocumentPosition(units) & 4).toBeTruthy();
  });
});

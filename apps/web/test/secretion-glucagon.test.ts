// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateAll, orient, registry, loadTable, checkUnits } from '@isat/core';
import { mountCalculate } from '../src/calculate/view';
import { buildInputs, emptyState } from '../src/calculate/state';
import { exampleState } from '../src/calculate/example';
import { seriesHint } from '../src/calculate/hints';
import { summaryHtml, orientationNoteHtml, availabilityHtml, type Snapshot } from '../src/calculate/results';
import { CATEGORIES, entryHtml, legacyText, methodsHtml } from '../src/methods/entries';
import { mountMethods } from '../src/methods/view';
import { mountUpload } from '../src/upload/view';
import { CATEGORIES as UP_CATEGORIES } from '../src/upload/analysis';
import { pageFor } from '../src/pages';
import { methodCounts } from '../src/counts';

const included = registry.filter((m) => m.deferredReason === undefined);
const template = readFileSync(resolve(process.cwd(), 'public/isat-template.csv'), 'utf8');
const readme = readFileSync(resolve(process.cwd(), '../../README.md'), 'utf8');

describe('one-person form: glucagon', () => {
  it('has a Glucagon column, a unit select and grey hints converted to pg/mL', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountCalculate(root);
    expect(root.querySelectorAll('input[data-c="glucagon"]').length).toBe(5);
    expect(root.querySelector('thead')!.textContent).toContain('Glucagon');
    const sel = root.querySelector<HTMLSelectElement>('#m-u-glucagon')!;
    expect([...sel.options].map((o) => o.value)).toEqual(['pmol/L', 'pg/mL']);
    expect(sel.value).toBe('pmol/L');
    const first = () => root.querySelector<HTMLInputElement>('input[data-r="0"][data-c="glucagon"]')!.placeholder;
    expect(first()).toBe('e.g. 12');
    sel.value = 'pg/mL'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(first()).toBe('e.g. 42');
    expect(seriesHint('glucagon', 30, { ...emptyState().units, glucagon: 'pmol/L' })).toBe('e.g. 9');
  });
  it('typed glucagon is converted to pmol/L; empty rows stay missing', () => {
    const st = emptyState();
    st.units.glucagon = 'pg/mL';
    st.rows[0]!.glucagon = '34.85';
    const { inputs, errors } = buildInputs(st);
    expect(errors).toEqual({});
    expect(inputs.glucagon![0]).toBeCloseTo(10, 10);
    expect(Object.keys(inputs.glucagon!)).toEqual(['0']);
    expect(buildInputs(emptyState()).inputs.glucagon).toBeUndefined();
  });
  it('Load example fills glucagon and the summary shows the new groups after the sensitivity groups', () => {
    const st = exampleState();
    expect(st.rows.map((r) => r.glucagon)).toEqual(['12', '9', '7', '7', '8']);
    const built = buildInputs(st);
    const snap: Snapshot = { state: st, built, results: calculateAll(built.inputs, { settings: built.settings }), calculatedAt: new Date(), version: 't' };
    const host = document.createElement('div');
    host.innerHTML = summaryHtml(orient(snap.results, 'published'), snap);
    const labels = [...host.querySelectorAll('tr.scat th')].map((t) => t.textContent);
    expect(labels.slice(-2)).toEqual(['Insulin secretion (beta cell)', 'Glucagon (alpha cell)']);
    const hb = host.querySelector('tr[data-row="homa_beta"]')!;
    expect(hb.children[2]!.textContent).toBe(registry.find((m) => m.id === 'homa_beta')!.direction_text);
    expect(host.querySelectorAll('tr.srow').length).toBe(snap.results.filter((r) => r.status === 'ok').length);
  });
  it('"Show which and why" lists the new indices', () => {
    const html = availabilityHtml(calculateAll({}));
    for (const id of ['homa_beta', 'glucagon_fasting', 'di_madsen_table']) expect(html).toContain(registry.find((m) => m.id === id)!.name);
  });
});

describe('upload: glucagon', () => {
  it('template has glucagon columns, all recognised, no problems; unit check passes', () => {
    const l = loadTable(template);
    expect(l.rowsWithProblems).toBe(0);
    expect(l.fileErrors).toEqual([]);
    expect(l.columns.filter((c) => c.kind === 'ignored')).toEqual([]);
    expect(l.columns.filter((c) => c.canonical?.startsWith('Glucagon')).map((c) => c.canonical)).toEqual(['Glucagon0', 'Glucagon30', 'Glucagon60', 'Glucagon120']);
    const units = { glucose: 'mmol/L', insulin: 'pmol/L', tg: 'mmol/L', hdl: 'mmol/L', ffa: 'mmol/L', glucagon: 'pmol/L' } as const;
    expect(checkUnits(l.inputs, units).filter((i) => i.suggested !== null)).toEqual([]);
  });
  it('glucagon unit select is hidden for files without glucagon and shown with it', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountUpload(root);
    const input = root.querySelector<HTMLInputElement>('#up-file')!;
    const load = async (text: string) => {
      Object.defineProperty(input, 'files', { value: [new File([text], 'f.csv', { type: 'text/csv' })], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
    };
    await load('id,G0,I0\nA,5,40\n');
    expect(root.querySelector<HTMLElement>('[data-glucagon-unit]')!.hidden).toBe(true);
    await load('id,G0,I0,glucagon_0\nA,5,40,12\n');
    expect(root.querySelector<HTMLElement>('[data-glucagon-unit]')!.hidden).toBe(false);
    expect(root.querySelector('.map-details')!.textContent).toContain('Glucagon0');
  });
  it('analysis category order puts secretion and glucagon last', () => {
    expect(UP_CATEGORIES.map(([k]) => k)).toEqual(['fasting', 'ogtt', 'lipid', 'tracer_dxa', 'secretion', 'glucagon']);
  });
  it('orientation note lists only sensitivity and resistance indices', () => {
    const d = document.createElement('div');
    d.innerHTML = orientationNoteHtml();
    const lists = [...d.querySelectorAll('details p')].map((p) => p.textContent!).join(' ');
    for (const m of included.filter((x) => x.category === 'secretion' || x.category === 'glucagon')) expect(lists).not.toContain(m.name);
  });
});

describe('methods page: secretion and glucagon', () => {
  it('has chips for both categories and filters by them', () => {
    expect(CATEGORIES.map(([k]) => k)).toEqual(expect.arrayContaining(['secretion', 'glucagon']));
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountMethods(root);
    const chip = root.querySelector<HTMLButtonElement>('[data-chip="secretion"]')!;
    expect(chip.textContent).toBe('Insulin secretion (beta cell)');
    chip.click();
    const shown = [...root.querySelectorAll<HTMLElement>('details.method')].filter((d) => !d.hidden);
    expect(shown.length).toBe(included.filter((m) => m.category === 'secretion').length);
  });
  it('entries show direction text, IsletCalc relation and the Di explanation', () => {
    const html = methodsHtml();
    const m = registry.find((x) => x.id === 'homa_beta')!;
    const e = document.createElement('div');
    e.innerHTML = entryHtml(m);
    expect(e.querySelector('.mdir')!.textContent).toBe(m.direction_text);
    expect(e.querySelector('.legacy')!.textContent).toContain('Identical to IsletCalc column Homa_beta');
    expect(e.querySelector('.legacy')!.textContent).toContain('0.1667');
    expect(legacyText({ id: 'x', isletcalc: { relation: 'none', column: null } })).toBe('Not in IsletCalc.');
    for (const id of ['di_madsen_table', 'di_xinsg30_matsuda']) {
      const d = document.createElement('div');
      d.innerHTML = entryHtml(registry.find((x) => x.id === id)!);
      expect(d.textContent).toContain('Supplementary Table 1');
      expect(d.textContent).toContain('several hundred times');
    }
    const pop = document.createElement('div');
    pop.innerHTML = html;
    const text = pop.querySelector('#m-populations')!.textContent!;
    expect(text).toContain('Insulin secretion (beta cell)');
    expect(text).toContain('Glucagon (alpha cell)');
  });
});

describe('wording and counts', () => {
  it('landing lede and counts follow the registry', () => {
    expect(pageFor('/')).toContain('insulin sensitivity, insulin secretion and glucagon indices');
    expect(pageFor('/')).toContain('Insulin Sensitivity Analysis Tool');
    expect(methodCounts().available).toBe(included.length);
  });
  it('about page mentions IsletCalc and Madsen 2024', () => {
    const a = pageFor('/about');
    expect(a).toContain('10.5281/zenodo.21420133');
    expect(a).toContain('10.1038/s42255-024-01140-6');
    expect(a).toContain('secretion');
    expect(a).toContain('glucagon');
  });
  it('README count matches the registry', () => {
    const sens = included.filter((m) => m.category !== 'secretion' && m.category !== 'glucagon').length;
    expect(readme).toContain(`**${included.length} published indices**: ${sens} insulin sensitivity`);
  });
});

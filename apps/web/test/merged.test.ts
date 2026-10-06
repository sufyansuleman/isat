// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { calculateAll, orient } from '@isat/core';
import { shell } from '../src/pages';
import { mountCalculatePage } from '../src/calculate/page';
import { buildInputs } from '../src/calculate/state';
import { exampleState } from '../src/calculate/example';
import { summaryHtml, wireSummary, type Snapshot } from '../src/calculate/results';
import { CATEGORIES } from '../src/methods/entries';
import { columnMappingSummary } from '../src/upload/view';

function mount(mode: 'manual' | 'upload') {
  document.body.innerHTML = shell('/');
  const root = document.getElementById('calculate-root')!;
  mountCalculatePage(root, mode);
  return root;
}

describe('merged Calculate page', () => {
  it('renders header, nav, guide and both tabs', () => {
    const root = mount('manual');
    expect(document.querySelector('h1')!.textContent).toBe('ISAT');
    expect(document.querySelector('nav a[aria-current="page"]')!.textContent).toBe('Calculate');
    expect([...document.querySelectorAll('nav a')].map((a) => a.textContent)).toEqual(['Calculate', 'Methods', 'About']);
    expect(root.querySelector('.guide')).not.toBeNull();
    expect(root.querySelectorAll('[role="tab"]').length).toBe(2);
    expect(root.querySelector<HTMLElement>('#panel-manual')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('#panel-upload')!.hidden).toBe(true);
  });
  it('upload alias opens the upload tab', () => {
    const root = mount('upload');
    expect(root.querySelector('#tab-upload')!.getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector<HTMLElement>('#panel-upload')!.hidden).toBe(false);
  });
  it('units render as inline pairs with unchanged ids', () => {
    const root = mount('manual');
    for (const k of ['glucose', 'insulin', 'tg', 'hdl', 'ffa']) {
      expect(root.querySelector(`.upair #m-u-${k}`)).not.toBeNull();
    }
  });
});

describe('summary table', () => {
  const st = exampleState();
  const built = buildInputs(st);
  const snap: Snapshot = { state: st, built, results: calculateAll(built.inputs, { settings: built.settings }), calculatedAt: new Date(), version: 't' };
  for (const mode of ['published', 'sensitivity'] as const) {
    it(`has one row per calculated result, grouped by category (${mode})`, () => {
      const o = orient(snap.results, mode);
      const host = document.createElement('div');
      host.innerHTML = summaryHtml(o, snap);
      const ok = o.filter((r) => r.status === 'ok');
      expect(host.querySelectorAll('tr.srow').length).toBe(ok.length);
      const labels = [...host.querySelectorAll('tr.scat th')].map((t) => t.textContent);
      const order = CATEGORIES.map(([, l]) => l);
      expect(labels.length).toBeGreaterThan(1);
      expect(labels.every((l) => order.includes(l!))).toBe(true);
      expect(labels).toEqual([...labels].sort((a, b) => order.indexOf(a!) - order.indexOf(b!)));
      expect(host.querySelectorAll('tr.sdetail[hidden]').length).toBe(ok.length);
    });
  }
  it('Details and Expand all / Collapse all toggle the cards', () => {
    const host = document.createElement('div');
    host.innerHTML = summaryHtml(orient(snap.results, 'published'), snap);
    wireSummary(host);
    const btn = host.querySelector<HTMLButtonElement>('[data-toggle]')!;
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelectorAll('tr.sdetail:not([hidden])').length).toBe(1);
    host.querySelector<HTMLButtonElement>('[data-expand="all"]')!.click();
    expect(host.querySelectorAll('tr.sdetail[hidden]').length).toBe(0);
    host.querySelector<HTMLButtonElement>('[data-expand="none"]')!.click();
    expect(host.querySelectorAll('tr.sdetail:not([hidden])').length).toBe(0);
  });
});

describe('column mapping summary', () => {
  it('reads "N of M columns recognised" with the not-recognised count only when > 0', () => {
    expect(columnMappingSummary([{ kind: 'id' }, { kind: 'variable' }, { kind: 'variable' }]))
      .toEqual({ text: '3 of 3 columns recognised', notRecognised: 0 });
    expect(columnMappingSummary([{ kind: 'id' }, { kind: 'variable' }, { kind: 'ignored' }]))
      .toEqual({ text: '2 of 3 columns recognised, 1 not recognised', notRecognised: 1 });
  });
});

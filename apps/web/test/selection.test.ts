// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INCLUDED, parseDelimited, resolveSelection, runBatch } from '@isat/core';

const saved: Array<{ blob: Blob; name: string }> = [];
vi.mock('../src/calculate/plots', async (orig) => ({
  ...(await orig<typeof import('../src/calculate/plots')>()),
  saveBlob: (blob: Blob, name: string) => { saved.push({ blob, name }); },
  drawChart: () => ({ destroy: () => undefined }),
}));

import { mountUpload } from '../src/upload/view';
import { mountCalculate } from '../src/calculate/view';
import { loadSelection, mountSelection, saveSelection } from '../src/selection';

const template = readFileSync(resolve(process.cwd(), 'public/isat-template.csv'), 'utf8');
const ALL = INCLUDED.length;
const ids = (g: string) => INCLUDED.filter((m) => m.category === g).map((m) => m.id);

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage(req: Parameters<typeof runBatch>[0]) {
    const msgs = [...runBatch(req)];
    setTimeout(() => { for (const m of msgs) this.onmessage?.({ data: m } as MessageEvent); }, 0);
  }
  terminate() { /* nothing */ }
}
const wait = async (cond: () => boolean) => { for (let k = 0; k < 100 && !cond(); k++) await new Promise((r) => setTimeout(r, 10)); };
const click = (el: Element | null) => (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
const chip = (root: HTMLElement, g: string) => root.querySelector<HTMLButtonElement>(`[data-sel-group="${g}"]`)!;
const box = (root: HTMLElement, id: string) => root.querySelector<HTMLInputElement>(`[data-sel-id="${id}"]`)!;
const toggleBox = (root: HTMLElement, id: string) => { const b = box(root, id); b.checked = !b.checked; b.dispatchEvent(new Event('change', { bubbles: true })); };
const pressed = (root: HTMLElement) => Object.fromEntries([...root.querySelectorAll<HTMLButtonElement>('[data-sel-group]')].map((b) => [b.dataset['selGroup']!, b.getAttribute('aria-pressed')!]));

async function mountFile() {
  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
  const root = document.createElement('div');
  document.body.appendChild(root);
  mountUpload(root);
  const input = root.querySelector<HTMLInputElement>('#up-file')!;
  Object.defineProperty(input, 'files', { value: [new File([template], 'f.csv')], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(() => !root.querySelector('#up-loaded')!.hasAttribute('hidden'));
  return root;
}
async function calculated() {
  const root = await mountFile();
  click(root.querySelector('#up-calc'));
  await wait(() => !root.querySelector('#up-results')!.hasAttribute('hidden'));
  return root;
}

beforeEach(() => { saved.length = 0; localStorage.clear(); document.body.innerHTML = ''; });

describe('selection control: chips and checklist', () => {
  it('starts with everything on; chips and checkboxes stay in sync', () => {
    const root = document.createElement('div');
    const seen: number[] = [];
    const ctl = mountSelection(root, 't', (s) => seen.push(s.size));
    expect(Object.values(pressed(root)).every((v) => v === 'true')).toBe(true);
    expect(root.querySelectorAll('[data-sel-id]').length).toBe(ALL);
    expect(ctl.get().size).toBe(ALL);
    click(chip(root, 'secretion'));
    expect(chip(root, 'secretion').getAttribute('aria-pressed')).toBe('false');
    expect(ids('secretion').every((i) => !box(root, i).checked)).toBe(true);
    expect(seen.at(-1)).toBe(ALL - ids('secretion').length);
    click(chip(root, 'secretion'));
    expect(chip(root, 'secretion').getAttribute('aria-pressed')).toBe('true');
    expect(ids('secretion').every((i) => box(root, i).checked)).toBe(true);
  });
  it('All and None; None leaves nothing selected', () => {
    const root = document.createElement('div');
    const ctl = mountSelection(root, 't', () => undefined);
    click(root.querySelector('[data-sel-none]'));
    expect(ctl.get().size).toBe(0);
    expect(Object.values(pressed(root)).every((v) => v === 'false')).toBe(true);
    expect(root.querySelector('[data-sel-count]')!.textContent).toMatch(/No indices selected/);
    click(root.querySelector('[data-sel-all]'));
    expect(ctl.get().size).toBe(ALL);
  });
  it('one unticked index makes its chip mixed; clicking a mixed chip turns the whole group on', () => {
    const root = document.createElement('div');
    const ctl = mountSelection(root, 't', () => undefined);
    const one = ids('fasting')[0]!;
    toggleBox(root, one);
    expect(chip(root, 'fasting').getAttribute('aria-pressed')).toBe('mixed');
    expect(chip(root, 'fasting').classList.contains('mixed')).toBe(true);
    expect(ctl.get().has(one)).toBe(false);
    click(chip(root, 'fasting'));
    expect(chip(root, 'fasting').getAttribute('aria-pressed')).toBe('true');
    expect(box(root, one).checked).toBe(true);
  });
});

describe('selection control: remembered in localStorage', () => {
  it('saves groups plus ids, restores them, and falls back to all', () => {
    const root = document.createElement('div');
    mountSelection(root, 't', () => undefined);
    click(root.querySelector('[data-sel-none]'));
    click(chip(root, 'glucagon'));
    toggleBox(root, 'homa_ir');
    const stored = JSON.parse(localStorage.getItem('isat-index-selection')!) as { groups: string[]; ids: string[] };
    expect(stored.groups).toEqual(['glucagon']);
    expect(stored.ids).toEqual(['homa_ir']);
    expect([...loadSelection()].sort()).toEqual(resolveSelection({ groups: ['glucagon'], ids: ['homa_ir'] }).sort());
    const again = document.createElement('div');
    const c2 = mountSelection(again, 't', () => undefined);
    expect(c2.get().size).toBe(ids('glucagon').length + 1);
    expect(chip(again, 'glucagon').getAttribute('aria-pressed')).toBe('true');
    localStorage.setItem('isat-index-selection', '{not json');
    expect(loadSelection().size).toBe(ALL);
    localStorage.setItem('isat-index-selection', JSON.stringify({ groups: ['bogus'], ids: [] }));
    expect(loadSelection().size).toBe(ALL);
  });
  it('works with a stub storage that throws', () => {
    const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadSelection(bad).size).toBe(ALL);
    expect(() => saveSelection(new Set(['homa_ir']), bad)).not.toThrow();
    const root = document.createElement('div');
    const ctl = mountSelection(root, 't', () => undefined, { storage: bad });
    click(chip(root, 'ogtt'));
    expect(ctl.get().size).toBe(ALL - ids('ogtt').length);
  });
});

describe('Calculate tab', () => {
  it('has the control above Calculate; the availability count and the results follow the selection immediately', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountCalculate(root);
    const sel = root.querySelector('#m-sel')!, calc = root.querySelector('#calc')!;
    expect(sel.compareDocumentPosition(calc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sel.textContent).toContain('Indices to include:');
    click(root.querySelector('#example'));
    click(calc);
    const avail = () => root.querySelector('.av-summary')!.textContent!;
    expect(avail()).toMatch(new RegExp(`of ${ALL} indices can be calculated`));
    const rows = () => root.querySelectorAll('#summary tr.srow').length;
    const all = rows();
    expect(all).toBeGreaterThan(10);
    click(root.querySelector('[data-sel-none]'));
    click(chip(root, 'secretion'));
    click(chip(root, 'glucagon'));
    const n = ids('secretion').length + ids('glucagon').length;
    expect(avail()).toMatch(new RegExp(`of ${n} indices can be calculated`));
    expect(rows()).toBeLessThan(all);
    const names = [...root.querySelectorAll('#summary tr.srow th')].map((t) => t.textContent);
    const allowed = INCLUDED.filter((m) => m.category === 'secretion' || m.category === 'glucagon').map((m) => m.name);
    expect(names.every((x) => allowed.includes(x!))).toBe(true);
    click(root.querySelector('[data-sel-none]'));
    expect(root.querySelector('#summary')!.textContent).toMatch(/No indices selected/);
    click(root.querySelector('[data-sel-all]'));
    expect(avail()).toMatch(new RegExp(`of ${ALL} indices can be calculated`));
    expect(rows()).toBe(all);
  });
  it('the results CSV lists the selected indices only', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountCalculate(root);
    click(root.querySelector('#example'));
    click(root.querySelector('#calc'));
    click(root.querySelector('[data-sel-none]'));
    click(chip(root, 'glucagon'));
    click(root.querySelector('#csv'));
    const rows = parseDelimited(await saved.at(-1)!.blob.text(), ',').slice(1);
    const names = new Set(INCLUDED.filter((m) => m.category === 'glucagon').map((m) => m.name));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => names.has(r[1]!))).toBe(true);
  });
});

describe('Upload tab', () => {
  it('the control sits above Calculate and the saved selection is used', async () => {
    saveSelection(new Set(resolveSelection({ groups: ['fasting'] })));
    const root = await mountFile();
    const sel = root.querySelector('#up-sel')!, calc = root.querySelector('#up-calc')!;
    expect(sel.compareDocumentPosition(calc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chip(root, 'fasting').getAttribute('aria-pressed')).toBe('true');
    expect(chip(root, 'secretion').getAttribute('aria-pressed')).toBe('false');
  });
  it('CSV columns, transformed columns and the settings file follow the selection; changing it needs no recalculation', async () => {
    const root = await calculated();
    const header = async () => { click(root.querySelector('#up-csv')); return parseDelimited(await saved.at(-1)!.blob.text(), ',')[0]!; };
    expect((await header()).length).toBe(2 + 2 * ALL); // default: z-score within sex columns are added
    click(root.querySelector('[data-sel-none]'));
    expect((root.querySelector('#up-csv') as HTMLButtonElement).disabled).toBe(true);
    expect((root.querySelector('#up-json') as HTMLButtonElement).disabled).toBe(true);
    click(chip(root, 'secretion'));
    click(chip(root, 'glucagon'));
    expect((root.querySelector('#up-csv') as HTMLButtonElement).disabled).toBe(false);
    const n = ids('secretion').length + ids('glucagon').length;
    const h = await header();
    expect(h.length).toBe(2 + 2 * n);
    const want = INCLUDED.filter((m) => m.category === 'secretion' || m.category === 'glucagon').flatMap((m) => [m.id, `${m.id}_z_bysex`]);
    expect(h.slice(2)).toEqual(want);
    expect(h.some((c) => c === 'homa_ir')).toBe(false);
    click(root.querySelector('#up-json'));
    const doc = JSON.parse(await saved.at(-1)!.blob.text()) as { selection: { groups: string[]; ids: string[]; methods: string[] }; methods: unknown[] };
    expect(doc.selection.groups).toEqual(['secretion', 'glucagon']);
    expect(doc.selection.ids).toEqual([]);
    expect(doc.selection.methods.length).toBe(n);
    expect(doc.methods.length).toBe(n);
    click(root.querySelector('[data-sel-all]'));
    click(root.querySelector('#up-json'));
    expect('selection' in JSON.parse(await saved.at(-1)!.blob.text())).toBe(false);
  });
  it('Summary rows and the Correlations matrix size follow the selection', async () => {
    const root = await calculated();
    click(root.querySelector('#up-tabbtn-summary'));
    const summaryRows = () => root.querySelectorAll('#up-tab-summary tbody tr:not(.scat)').length;
    expect(summaryRows()).toBe(ALL);
    click(root.querySelector('#up-tabbtn-cor'));
    const cells = () => root.querySelectorAll('#up-tab-cor .heat-cell').length;
    const full = cells();
    expect(full).toBeGreaterThan(0);
    click(root.querySelector('[data-sel-none]'));
    click(chip(root, 'secretion'));
    const k2 = cells();
    expect(Math.sqrt(k2)).toBeLessThanOrEqual(ids('secretion').length);
    expect(k2).toBeLessThan(full);
    click(root.querySelector('#up-tabbtn-summary'));
    expect(summaryRows()).toBe(ids('secretion').length);
    click(root.querySelector('#up-tabbtn-cor'));
    expect(cells()).toBe(k2);
    click(root.querySelector('[data-sel-all]'));
    expect(cells()).toBe(full);
  });
});

describe('selection is shared between the two tabs', () => {
  it('a change in one control updates the other at once and calls its onChange', () => {
    const a = document.createElement('div'), b = document.createElement('div');
    document.body.append(a, b);
    const store = { v: null as string | null, load() { return this.v; }, save(s: string) { this.v = s; } };
    const seen: number[] = [];
    mountSelection(a, 'ta', () => {}, { storage: store } as never);
    const cb = mountSelection(b, 'tb', (ids) => seen.push(ids.size), { storage: store } as never);
    (a.querySelector('[data-sel-none]') as HTMLButtonElement).click();
    expect(cb.get().size).toBe(0);
    expect(seen.at(-1)).toBe(0);
    (a.querySelector('[data-sel-all]') as HTMLButtonElement).click();
    expect(cb.get().size).toBeGreaterThan(0);
    a.remove(); b.remove();
  });
});

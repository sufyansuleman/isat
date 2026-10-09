// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const saved: Array<{ blob: Blob; name: string }> = [];
vi.mock('../src/calculate/plots', async (orig) => ({
  ...(await orig<typeof import('../src/calculate/plots')>()),
  saveBlob: (blob: Blob, name: string) => { saved.push({ blob, name }); },
}));

import { mountUpload } from '../src/upload/view';
import { runBatch } from '@isat/core';

const template = readFileSync(resolve(process.cwd(), 'public/isat-template.csv'), 'utf8');

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

async function mountWith(csv: string) {
  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
  const root = document.createElement('div');
  document.body.appendChild(root);
  mountUpload(root);
  const input = root.querySelector<HTMLInputElement>('#up-file')!;
  Object.defineProperty(input, 'files', { value: [new File([csv], 'f.csv')], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(() => !root.querySelector('#up-loaded')!.hasAttribute('hidden'));
  (root.querySelector('#up-calc') as HTMLButtonElement).click();
  await wait(() => !root.querySelector('#up-results')!.hasAttribute('hidden'));
  return root;
}
const pick = (root: HTMLElement, id: string, value: string) => {
  const el = root.querySelector<HTMLSelectElement>(id)!;
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const noTransform = (root: HTMLElement) => { pick(root, '#up-tf', 'none'); return root; };
const openCor = (root: HTMLElement) => (root.querySelector('#up-tabbtn-cor') as HTMLButtonElement).click();
const titles = (root: HTMLElement, scope = '#up-tab-cor') => [...root.querySelectorAll(`${scope} .heat-cell title`)].map((t) => t.textContent!);
const SPEARMAN_NOTE = "Spearman uses ranks, so log, z-score and RINT do not change it; only 'within sex' can.";
const PEARSON_NOTE = 'Pearson on raw values is sensitive to skewed distributions and extreme values; consider a transform.';

beforeEach(() => { saved.length = 0; });

describe('Correlations tab: method, values and notes', () => {
  it('defaults to Spearman and switching to Pearson changes the cell values', async () => {
    const root = await mountWith(template);
    openCor(root);
    expect(root.querySelector<HTMLSelectElement>('#up-cor-method')!.value).toBe('spearman');
    const sp = titles(root);
    expect(sp[1]).toMatch(/Spearman rho = .*, n = \d+/);
    pick(root, '#up-cor-method', 'pearson');
    const pe = titles(root);
    expect(pe.length).toBe(sp.length);
    expect(pe[1]).toMatch(/Pearson r = .*, n = \d+/);
    const num = (t: string) => Number(/= (-?[\d.]+),/.exec(t)![1]);
    expect(pe.some((t, i) => Math.abs(num(t) - num(sp[i]!)) > 0.01)).toBe(true);
  });

  it('disables Transformed and Both when the transform is None, with a note', async () => {
    const root = noTransform(await mountWith(template));
    openCor(root);
    const opts = [...root.querySelectorAll<HTMLOptionElement>('#up-cor-values option')];
    expect(opts.map((o) => [o.value, o.disabled])).toEqual([['raw', false], ['transformed', true], ['both', true]]);
    expect(root.querySelector<HTMLElement>('#up-cor-tfnote')!.hidden).toBe(false);
    pick(root, '#up-tf', 'rint');
    expect(root.querySelector<HTMLOptionElement>('#up-cor-values option[value="both"]')!.disabled).toBe(false);
    expect(root.querySelector<HTMLElement>('#up-cor-tfnote')!.hidden).toBe(true);
  });

  it('shows the Spearman and Pearson notes only in their conditions', async () => {
    const root = noTransform(await mountWith(template));
    openCor(root);
    const notes = () => [...root.querySelectorAll('#up-tab-cor .cor-note')].map((n) => n.textContent);
    expect(notes()).toEqual([]); // Spearman, no transform
    pick(root, '#up-tf', 'rint');
    const by = root.querySelector<HTMLInputElement>('#up-bysex')!;
    by.checked = false; by.dispatchEvent(new Event('change', { bubbles: true })); // within sex is on by default
    expect(notes()).toEqual([SPEARMAN_NOTE]);
    by.checked = true; by.dispatchEvent(new Event('change', { bubbles: true }));
    expect(notes()).toEqual([]); // within sex can change Spearman
    pick(root, '#up-cor-method', 'pearson');
    expect(notes()).toEqual([]); // Pearson on transformed values
    pick(root, '#up-cor-values', 'raw');
    expect(notes()).toEqual([PEARSON_NOTE]);
    pick(root, '#up-tf', 'none');
    expect(notes()).toEqual([PEARSON_NOTE]); // no transform: Raw only
  });

  it('Both draws Raw, Transformed and Difference heatmaps, each n x n', async () => {
    const root = await mountWith(template);
    pick(root, '#up-tf', 'log');
    openCor(root);
    pick(root, '#up-cor-method', 'pearson');
    pick(root, '#up-cor-values', 'both');
    const maps = [...root.querySelectorAll('#up-tab-cor .heat-one')];
    expect(maps.map((m) => (m as HTMLElement).dataset['heat'])).toEqual(['raw', 'transformed', 'difference']);
    const k = Math.round(Math.sqrt(maps[0]!.querySelectorAll('.heat-cell').length));
    expect(k).toBeGreaterThanOrEqual(3);
    for (const m of maps) expect(m.querySelectorAll('.heat-cell').length).toBe(k * k);
    expect(maps[0]!.querySelector('svg')!.textContent).toContain('Raw');
    expect(maps[1]!.querySelector('svg')!.textContent).toContain('Transformed: natural log');
    expect(maps[2]!.querySelector('svg')!.textContent).toContain('Difference (transformed minus raw)');
    const gradients = [...root.querySelectorAll('#up-tab-cor linearGradient')].map((g) => g.id);
    expect(new Set(gradients).size).toBe(3);
    expect(root.querySelector('#up-heat .heat-cell title')!.textContent).toMatch(/raw = .*transformed = .*difference = /);
    // scatter: raw and transformed side by side
    (root.querySelectorAll('#up-heat .heat-cell')[1] as unknown as HTMLElement).dispatchEvent(new Event('click', { bubbles: true }));
    expect(root.querySelectorAll('#up-scatter svg').length).toBe(2);
    expect(root.querySelector('#up-scatter')!.textContent).toMatch(/Pearson r = /);
  });

  it('downloads a long-format CSV in Both mode and the matrix CSV otherwise', async () => {
    const root = await mountWith(template);
    pick(root, '#up-tf', 'log');
    openCor(root);
    pick(root, '#up-cor-method', 'pearson');
    (root.querySelector('#up-cor-csv') as HTMLButtonElement).click();
    expect(saved.at(-1)!.name).toBe('isat-pearson-matrix.csv');
    pick(root, '#up-cor-values', 'both');
    (root.querySelector('#up-cor-long') as HTMLButtonElement).click();
    expect(saved.at(-1)!.name).toBe('isat-pearson-comparison.csv');
    const lines = (await saved.at(-1)!.blob.text()).trim().split('\r\n');
    expect(lines[0]).toBe('row,col,raw,transformed,difference,n_raw,n_transformed');
    const k = Math.round(Math.sqrt(lines.length - 1));
    expect(k * k).toBe(lines.length - 1);
    const first = lines[1]!.split(',');
    expect(first.length).toBe(7);
    expect(Number(first[2])).toBeCloseTo(1, 12); // diagonal
    expect(Number(first[4])).toBeCloseTo(Number(first[3]) - Number(first[2]), 12);
    (root.querySelector('[data-dl="heat-diff"]') as HTMLButtonElement).click();
    expect(saved.at(-1)!.name).toBe('isat-pearson-heatmap-difference.svg');
  });

  it('records the correlation settings in the settings file', async () => {
    const root = noTransform(await mountWith(template));
    (root.querySelector('#up-json') as HTMLButtonElement).click();
    let doc = JSON.parse(await saved.at(-1)!.blob.text());
    expect(doc.correlation).toEqual({ method: 'spearman', values: 'raw' }); // no transform: Raw
    pick(root, '#up-tf', 'rint');
    openCor(root);
    pick(root, '#up-cor-method', 'pearson');
    pick(root, '#up-cor-values', 'both');
    (root.querySelector('#up-json') as HTMLButtonElement).click();
    doc = JSON.parse(await saved.at(-1)!.blob.text());
    expect(doc.correlation).toEqual({ method: 'pearson', values: 'both' });
    expect(doc.transform).toMatchObject({ kind: 'rint' });
  });
});

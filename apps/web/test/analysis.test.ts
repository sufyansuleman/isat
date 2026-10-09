// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { qnorm } from '@isat/core';

const saved: Array<{ blob: Blob; name: string }> = [];
vi.mock('../src/calculate/plots', async (orig) => ({
  ...(await orig<typeof import('../src/calculate/plots')>()),
  saveBlob: (blob: Blob, name: string) => { saved.push({ blob, name }); },
}));

import { mountUpload } from '../src/upload/view';
import { runBatch, composeCsv, settingsFile, INCLUDED } from '@isat/core';
import { Analysis, matrixCsv, transformSuffix } from '../src/upload/analysis';
import { densitySvg, histogram, histogramSvg, heatmapSvg, scatterSvg, samplePairs, divergingColour } from '../src/calculate/svg';
import { loadTable, parseDelimited, toCanonical } from '@isat/core';
import { DEFAULT_UNITS } from '../src/calculate/state';

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

async function mountWith(csv: string, name = 'f.csv') {
  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
  const root = document.createElement('div');
  document.body.appendChild(root);
  mountUpload(root);
  const input = root.querySelector<HTMLInputElement>('#up-file')!;
  Object.defineProperty(input, 'files', { value: [new File([csv], name)], configurable: true });
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
const tick = () => new Promise((r) => setTimeout(r, 0));

// The app defaults are z-score within sex, Distributions tab, Show all. These tests need the classic state, so set it explicitly.
function classic(root: HTMLElement) {
  pick(root, '#up-tf', 'none');
  (root.querySelector('#up-tabbtn-dist') as HTMLButtonElement).click();
  const all = root.querySelector<HTMLInputElement>('#up-dist-all')!;
  all.checked = false; all.dispatchEvent(new Event('change', { bubbles: true }));
  (root.querySelector('#up-tabbtn-summary') as HTMLButtonElement).click();
  return root;
}

beforeEach(() => { saved.length = 0; });

describe('results tabs', () => {
  it('renders Summary | Distributions | Correlations | Participants', async () => {
    const root = classic(await mountWith(template));
    const tabs = [...root.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(tabs).toEqual(['Summary', 'Distributions', 'Correlations', 'Participants']);
    expect(root.querySelector('#up-tab-summary table.stats')).not.toBeNull();
    expect(root.querySelector('#up-tab-summary details.why.inline')).not.toBeNull();
    (root.querySelector('#up-tabbtn-dist') as HTMLButtonElement).click();
    expect(root.querySelectorAll('#up-tab-dist svg').length).toBe(1); // Raw only: no transform
    pick(root, '#up-tf', 'rint');
    expect(root.querySelectorAll('#up-tab-dist svg').length).toBe(2); // Raw + Transformed
    (root.querySelector('#up-tabbtn-people') as HTMLButtonElement).click();
    expect(root.querySelectorAll('#up-list button').length).toBe(10);
    expect(root.querySelector<HTMLElement>('#up-tab-summary')!.hidden).toBe(true);
  });

  it('draws an n x n heatmap and opens a scatter on click', async () => {
    const root = await mountWith(template);
    pick(root, '#up-tf', 'rint');
    (root.querySelector('#up-tabbtn-cor') as HTMLButtonElement).click();
    const cells = root.querySelectorAll('#up-tab-cor .heat-cell');
    const k = Math.round(Math.sqrt(cells.length));
    expect(k).toBeGreaterThanOrEqual(3);
    expect(k * k).toBe(cells.length);
    expect(cells[1]!.querySelector('title')!.textContent).toMatch(/rho = .*, n = \d+/);
    (cells[1] as unknown as HTMLElement).dispatchEvent(new Event('click', { bubbles: true }));
    expect(root.querySelector('#up-scatter svg')).not.toBeNull();
    expect(root.querySelector('#up-scatter svg')!.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
    (root.querySelector('#up-cor-csv') as HTMLButtonElement).click();
    expect(saved.at(-1)!.name).toBe('isat-spearman-matrix.csv');
    const lines = (await saved.at(-1)!.blob.text()).trim().split('\r\n');
    expect(lines.length).toBe(k + 1);
  });

  it('adds transformed columns to the CSV and records the transform in the settings file', async () => {
    const root = await mountWith(template);
    pick(root, '#up-tf', 'rint');
    const by = root.querySelector<HTMLInputElement>('#up-bysex')!;
    expect(by.disabled).toBe(false);
    by.checked = true;
    by.dispatchEvent(new Event('change', { bubbles: true }));
    (root.querySelector('#up-csv') as HTMLButtonElement).click();
    const csv = parseDelimited(await saved.at(-1)!.blob.text(), ',');
    const h = csv[0]!;
    const i = h.indexOf('homa_ir');
    expect(h[i + 1]).toBe('homa_ir_rint_bysex');
    expect(h[h.indexOf('quicki') + 1]).toBe('quicki_rint_bysex');
    expect(h.length).toBe(2 + 2 * INCLUDED.length);
    expect(csv.every((r) => r.length === h.length)).toBe(true);
    (root.querySelector('#up-addtf') as HTMLInputElement).checked = false;
    root.querySelector('#up-addtf')!.dispatchEvent(new Event('change', { bubbles: true }));
    (root.querySelector('#up-csv') as HTMLButtonElement).click();
    expect(parseDelimited(await saved.at(-1)!.blob.text(), ',')[0]!.length).toBe(2 + INCLUDED.length);
    (root.querySelector('#up-json') as HTMLButtonElement).click();
    const doc = JSON.parse(await saved.at(-1)!.blob.text());
    expect(doc.transform).toMatchObject({ kind: 'rint', within_sex: true, blom_offset: 0.375, log_base: 'e', z_sd: 'sample (n - 1)', transformed_columns_added: false });
  });

  it('disables "within sex" with a note when the file has no sex column', async () => {
    const noSex = template.split(/\r?\n/).filter(Boolean).map((l, k) => {
      const c = l.split(',');
      return (k === 0 ? c.filter((x) => x !== 'sex') : c.filter((_, j) => j !== 2)).join(',');
    }).join('\n');
    const root = await mountWith(noSex);
    const by = root.querySelector<HTMLInputElement>('#up-bysex')!;
    expect(by.disabled).toBe(true);
    expect(root.querySelector('#up-sex-note')!.textContent).toContain('No sex column');
  });

  it('puts the status checkbox before its label text', async () => {
    const root = await mountWith(template);
    const lab = root.querySelector('#up-status')!.closest('label')!;
    expect(lab.firstElementChild!.id).toBe('up-status');
  });

  it('downloads a standalone density SVG (default plot type)', async () => {
    const root = classic(await mountWith(template));
    (root.querySelector('#up-tabbtn-dist') as HTMLButtonElement).click();
    (root.querySelector('#up-tab-dist button[data-dl="raw"]') as HTMLButtonElement).click();
    expect(saved.at(-1)!.name).toMatch(/^isat-density-.*-raw\.svg$/);
    const svg = await saved.at(-1)!.blob.text();
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('font-family=');
    await tick();
  });
});

describe('svg builders', () => {
  it('histogram SVG is standalone with white background, font fallback and N / missing caption', () => {
    const svg = histogramSvg({ values: [1, 2, 2, 3, 4, 9, NaN], xLabel: 'HOMA-IR', title: 'Raw', colour: '#0072B2', total: 8 });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('font-family="system-ui');
    expect(svg).toContain('N = 6; missing = 2 (of 8)');
    expect(svg).toContain('median');
    expect(svg).not.toMatch(/style=|<style|https?:\/\/(?!www\.w3\.org)/);
  });
  it('bins: Freedman-Diaconis clamped to 10-60, Sturges fallback when IQR = 0', () => {
    expect(histogram([1, 2, 3, 4, 5])!.bins).toBe(10);
    const big = Array.from({ length: 100000 }, (_, i) => (i < 5 ? 1e6 : Math.sin(i)));
    expect(histogram(big)!.bins).toBe(60);
    expect(histogram(Array(100).fill(5))!.bins).toBe(10);
    expect(histogram([])).toBeNull();
  });
  it('heatmap has k x k cells with titles; scatter title carries rho and n; sampling is deterministic', () => {
    const rho = [1, 0.5, 0.5, 1], n = [5, 5, 5, 5];
    const svg = heatmapSvg({ labels: ['A', 'B'], rho, n, title: 't' });
    expect((svg.match(/class="heat-cell"/g) ?? []).length).toBe(4);
    expect(svg).toContain('rho = 0.500, n = 5');
    expect(divergingColour(-1)).toBe('#2166ac');
    expect(divergingColour(0)).toBe('#f7f7f7');
    expect(divergingColour(1)).toBe('#b2182b');
    const x = Array.from({ length: 30000 }, (_, i) => i), y = x.map((v) => v * 2);
    const s1 = samplePairs(x, y, 20000), s2 = samplePairs(x, y, 20000);
    expect(s1.px.length).toBe(20000);
    expect(s1.px).toEqual(s2.px);
    const sc = scatterSvg({ x, y, xLabel: 'X', yLabel: 'Y', rho: 1, n: 30000 });
    expect(sc).toContain('Spearman rho = 1.000, n = 30,000');
    expect(sc).toContain('Showing 20,000 of 30,000 pairs');
  });
});

describe('analysis model', () => {
  const l = loadTable(template);
  const canonical = l.inputs.map((i) => toCanonical(i, DEFAULT_UNITS, { glucose_mg_per_dL_per_mmol: 18, insulin_pmol_per_uU: 6 }));
  const chunks = [...runBatch({ type: 'run', rows: canonical, ids: l.ids, settings: {}, avignon: 'default', chunkRows: 4 })]
    .flatMap((m) => (m.type === 'chunk' ? [m.payload] : []));
  const sexes = l.inputs.map((i) => i.sex ?? null);
  const col = (id: string) => INCLUDED.findIndex((m) => m.id === id);

  it('reads oriented columns: _inv methods are negated only under the sensitivity convention', () => {
    const pub = new Analysis(chunks, 'published', sexes), sen = new Analysis(chunks, 'sensitivity', sexes);
    const c = col('homa_ir');
    pub.raw(c).forEach((v, i) => { expect(sen.raw(c)[i]).toBe(Number.isNaN(v) ? NaN : -v); });
    const q = col('quicki');
    expect(Array.from(sen.raw(q))).toEqual(Array.from(pub.raw(q)));
  });

  it('RINT is Blom on the oriented values, and within sex uses the per-sex n', () => {
    const an = new Analysis(chunks, 'published', sexes);
    const c = col('homa_ir');
    const v = an.raw(c);
    const ok = Array.from(v).filter((x) => !Number.isNaN(x)).length;
    const lowest = Array.from(v).indexOf(Math.min(...Array.from(v).filter((x) => !Number.isNaN(x))));
    expect(an.transformed(c, { kind: 'rint', bySex: false }).values[lowest]).toBeCloseTo(qnorm((1 - 0.375) / (ok + 0.25)), 10);
    const by = an.transformed(c, { kind: 'rint', bySex: true });
    expect(Object.keys(by.groupN).sort()).toEqual(['female', 'male']);
    expect(by.groupN['male']! + by.groupN['female']!).toBe(ok);
  });

  it('caches the correlation matrix per setting; z and RINT without within-sex share the raw matrix', () => {
    const an = new Analysis(chunks, 'published', sexes);
    const a = an.matrix({ kind: 'none', bySex: false });
    expect(an.matrix({ kind: 'rint', bySex: false })).toBe(a);
    expect(an.matrix({ kind: 'z', bySex: false })).toBe(a);
    expect(an.matrix({ kind: 'rint', bySex: true })).not.toBe(a);
    expect(an.hasMatrix({ kind: 'log', bySex: false })).toBe(false);
    const lines = matrixCsv(a, 'published', 'rho').trim().split('\r\n');
    expect(lines.length).toBe(a.k + 1);
    expect(lines[0]!.split(',').length).toBe(a.k + 1);
    for (let i = 0; i < a.k; i++) expect(a.rho[i * a.k + i]).toBe(1);
  });

  it('composeCsv places transformed columns right after each index with the _bysex suffix', () => {
    const an = new Analysis(chunks, 'published', sexes);
    const t = { kind: 'log', bySex: true } as const;
    const text = composeCsv(chunks, 'published', false, { suffix: transformSuffix(t), cols: an.transformedColumns(t) }).join('');
    const rowsOut = parseDelimited(text, ',');
    const h = rowsOut[0]!;
    expect(h.slice(2, 6)).toEqual([INCLUDED[0]!.id, `${INCLUDED[0]!.id}_log_bysex`, INCLUDED[1]!.id, `${INCLUDED[1]!.id}_log_bysex`]);
    const c = col('homa_ir');
    rowsOut.slice(1).forEach((r, i) => {
      const raw = r[2 + 2 * c]!, tr = r[3 + 2 * c]!;
      expect(tr).toBe(raw === '' || sexes[i] === null ? '' : String(Math.log(Number(raw))));
    });
  });

  it('records no transform as kind none', () => {
    const doc = settingsFile({
      version: 'x', timestamp: 't', fileName: 'f', delimiter: 'comma', units: {}, settings: {},
      avignon: { w: 0.137, source: 'avignon_1999', warnings: [] }, orientation: 'published', includeStatus: false,
      rows: { total: 1, withProblems: 0, calculated: 1 },
    });
    expect(doc['transform']).toEqual({ kind: 'none' });
  });
});

describe('density and sex split', () => {
  const noSex = template.split(/\r?\n/).map((l) => { const c = l.split(','); c.splice(2, 1); return c.join(','); }).join('\n');
  const openDist = (root: HTMLElement) => (root.querySelector('#up-tabbtn-dist') as HTMLButtonElement).click();
  const tick1 = (root: HTMLElement, id: string, on: boolean) => {
    const el = root.querySelector<HTMLInputElement>(id)!;
    el.checked = on; el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  it('density SVG has one path per sex plus a legend with n, and an optional combined curve', async () => {
    const root = classic(await mountWith(template));
    openDist(root);
    const svg = root.querySelector('#up-tab-dist svg')!;
    expect(svg.querySelectorAll('path.dens').length).toBe(2);
    expect(svg.textContent).toMatch(/Men \(n = \d+\)/);
    expect(svg.textContent).toMatch(/Women \(n = \d+\)/);
    expect(svg.textContent).toContain('bandwidth (bw.nrd0):');
    expect(svg.querySelectorAll('line.med').length).toBe(2);
    expect(svg.querySelector('path.dens[stroke-dasharray]')).not.toBeNull(); // line style differs, not only colour
    tick1(root, '#up-dist-comb', true);
    expect(root.querySelectorAll('#up-tab-dist svg')[0]!.querySelectorAll('path.dens').length).toBe(3);
    tick1(root, '#up-dist-split', false);
    expect(root.querySelectorAll('#up-tab-dist svg')[0]!.querySelectorAll('path.dens').length).toBe(1);
  });
  it('shows raw and RINT-within-sex density side by side', async () => {
    const root = classic(await mountWith(template));
    pick(root, '#up-tf', 'rint');
    openDist(root);
    const svgs = root.querySelectorAll('#up-tab-dist svg');
    expect(svgs.length).toBe(2);
    expect(svgs[1]!.querySelectorAll('path.dens').length).toBe(2);
  });
  it('hides Split by sex and draws one curve when the file has no sex column', async () => {
    const root = await mountWith(noSex);
    openDist(root);
    expect(root.querySelector('#up-dist-split')).toBeNull();
    expect(root.querySelectorAll('#up-tab-dist svg')[0]!.querySelectorAll('path.dens').length).toBe(1);
  });
  it('summary has per-sex median columns only when sex is available', async () => {
    const withSex = classic(await mountWith(template));
    const heads = [...withSex.querySelectorAll('#up-tab-summary thead th')].map((t) => t.textContent);
    expect(heads).toContain('Median (men)');
    expect(heads).toContain('Median (women)');
    expect(withSex.querySelector('#up-tab-summary td[title^="n = "]')).not.toBeNull();
    const without = classic(await mountWith(noSex));
    const h2 = [...without.querySelectorAll('#up-tab-summary thead th')].map((t) => t.textContent);
    expect(h2).not.toContain('Median (men)');
    expect(without.querySelectorAll('#up-tab-summary thead th').length).toBe(6);
  });
  it('histogram mode overlays one set of bars per sex', async () => {
    const root = await mountWith(template);
    openDist(root);
    const r = root.querySelector<HTMLInputElement>('input[name="up-dist-kind"][value="hist"]')!;
    r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true }));
    const svg = root.querySelector('#up-tab-dist svg')!;
    expect(svg.querySelectorAll('rect.hbar[data-group="Men"]').length).toBeGreaterThan(0);
    expect(svg.querySelectorAll('rect.hbar[data-group="Women"]').length).toBeGreaterThan(0);
    expect(svg.textContent).toMatch(/Women \(n = \d+\)/);
  });
  it('downloads density data as a long-format CSV', async () => {
    const root = classic(await mountWith(template));
    openDist(root);
    (root.querySelector('#up-dist-csv') as HTMLButtonElement).click();
    expect(saved.at(-1)!.name).toMatch(/^isat-density-.*-raw\.csv$/);
    const lines = (await saved.at(-1)!.blob.text()).trim().split('\r\n');
    expect(lines[0]).toBe('index,scale,group,n,bandwidth,x,density');
    expect(lines.length).toBe(1 + 2 * 256);
    const groups = new Set(lines.slice(1).map((l) => l.split(',').at(-5)));
    expect([...groups].sort()).toEqual(['men', 'women']);
    const f = lines[1]!.split(',');
    expect(Number(f.at(-1))).toBeGreaterThan(0);
    expect(Number(f.at(-3))).toBeGreaterThan(0); // bandwidth
  });
  it('Show all draws a density small multiple per calculated index', async () => {
    const root = await mountWith(template);
    openDist(root);
    tick1(root, '#up-dist-all', true);
    await wait(() => root.querySelector('#up-dist-status') === null);
    const n = root.querySelectorAll('#up-dist-grid figure').length;
    expect(n).toBeGreaterThan(5);
    expect(root.querySelectorAll('#up-dist-grid svg')[0]!.querySelectorAll('path.dens').length).toBe(2);
  });
  it('densitySvg labels use 3 / 4 significant digits', () => {
    const x = Array.from({ length: 20 }, (_, i) => i / 3), y = x.map(() => 0.123456789);
    const svg = densitySvg({ curves: [{ label: 'All', colour: '#000', dash: '', width: 2, n: 20, x, y, bw: 0.123456789, median: 3.14159265 }], xLabel: 'v', title: 'T', total: 22, n: 20 });
    expect(svg).toContain('bandwidth (bw.nrd0) = 0.123');
    expect(svg).toContain('median = 3.142');
    expect(svg).toContain('missing = 2 (of 22)');
  });
});

describe('new upload defaults', () => {
  const noSex = template.split(/\r?\n/).map((l) => { const c = l.split(','); c.splice(2, 1); return c.join(','); }).join('\n');
  const checked = (root: HTMLElement, sel: string) => root.querySelector<HTMLInputElement>(sel)!.checked;

  it('opens on z-score within sex, Distributions, Show all, Density, Split by sex', async () => {
    const root = await mountWith(template);
    expect(root.querySelector<HTMLOptionElement>('#up-tf option[selected]')!.value).toBe('z'); // happy-dom mis-reports select.value for a parsed selected option
    expect(checked(root, '#up-bysex')).toBe(true);
    expect(root.querySelector<HTMLInputElement>('#up-bysex')!.disabled).toBe(false);
    expect(checked(root, '#up-addtf')).toBe(true);
    expect(root.querySelector('#up-tabbtn-dist')!.getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector<HTMLElement>('#up-tab-dist')!.hidden).toBe(false);
    expect(checked(root, '#up-dist-all')).toBe(true);
    expect(checked(root, 'input[name="up-dist-kind"][value="density"]')).toBe(true);
    expect(checked(root, '#up-dist-split')).toBe(true);
  });

  it('without a sex column, within sex is off and disabled', async () => {
    const root = await mountWith(noSex);
    expect(root.querySelector<HTMLOptionElement>('#up-tf option[selected]')!.value).toBe('z'); // happy-dom mis-reports select.value for a parsed selected option
    expect(checked(root, '#up-bysex')).toBe(false);
    expect(root.querySelector<HTMLInputElement>('#up-bysex')!.disabled).toBe(true);
  });

  it('the default results CSV has *_z_bysex columns and the settings file records z within sex', async () => {
    const root = await mountWith(template);
    (root.querySelector('#up-csv') as HTMLButtonElement).click();
    const h = parseDelimited(await saved.at(-1)!.blob.text(), ',')[0]!;
    expect(h).toContain('homa_ir_z_bysex');
    expect(h.length).toBe(2 + 2 * INCLUDED.length);
    (root.querySelector('#up-json') as HTMLButtonElement).click();
    const doc = JSON.parse(await saved.at(-1)!.blob.text());
    expect(doc.transform).toMatchObject({ kind: 'z', within_sex: true, transformed_columns_added: true });
  });
});

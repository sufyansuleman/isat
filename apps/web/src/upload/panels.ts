// Result tabs for an uploaded file: Summary, Distributions and Correlations (Participants stays in view.ts).
import { esc, fmt4 } from '../calculate/format';
import { saveBlob } from '../calculate/plots';
import { densitySvg, GROUP_STYLE, heatmapSvg, histogramGroupsSvg, histogramSvg, OKABE_ITO, scatterSvg, type Curve } from '../calculate/svg';
import {
  Analysis, CATEGORIES, KIND_LABEL, NO_TRANSFORM, densityCsv, matrixCsv, transformedLabel, type TransformSetting,
} from './analysis';
import { INCLUDED, topReasons, type Counts } from '@isat/core';

const nf = (v: number) => v.toLocaleString('en-GB');
const DASH = '—';
const stat = (v: number | null) => (v === null ? DASH : fmt4(v));

/** INCLUDED positions grouped by category (registry order inside each group). */
function grouped(): Array<[string, number[]]> {
  const known = new Set(CATEGORIES.map(([k]) => k));
  const out = CATEGORIES.map(([k, label]) => [label, INCLUDED.flatMap((m, c) => (m.category === k ? [c] : []))] as [string, number[]]);
  const other = INCLUDED.flatMap((m, c) => (known.has(m.category) ? [] : [c]));
  if (other.length) out.push(['Other', other]);
  return out.filter(([, cs]) => cs.length);
}

export const svgBlob = (svg: string) => new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });

/** Per-figure download buttons: figures register their SVG under a key; one click handler serves the host. */
function wireDownloads(host: HTMLElement, files: Map<string, { svg: string; name: string }>): void {
  host.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-dl]');
    const f = b && files.get(b.dataset['dl']!);
    if (f) saveBlob(svgBlob(f.svg), f.name);
  });
}

// ---------- Summary ----------
function sexCells(an: Analysis, c: number, ok: boolean): string {
  if (!ok) return `<td class="num">${DASH}</td><td class="num">${DASH}</td>`;
  const s = an.sexMedians(c);
  const cell = (g: { median: number | null; n: number }) => `<td class="num" title="n = ${nf(g.n)}">${g.median === null ? DASH : fmt4(g.median)}</td>`;
  return cell(s.male) + cell(s.female);
}

export function summaryHtml(an: Analysis, counts: Counts, n: number): string {
  const sx = an.hasSex;
  const cols = sx ? 8 : 6;
  const rows = grouped().map(([label, cs]) => {
    const body = cs.map((c) => {
      const m = INCLUDED[c]!, ct = counts[m.id]!;
      const missing = ct.unavailable + ct.error;
      const lines = [
        ...topReasons(ct.unavailableReasons).map(([k, v]) => `${esc(k)} (${nf(v)})`),
        ...topReasons(ct.errorReasons).map(([k, v]) => `error: ${esc(k)} (${nf(v)})`),
      ];
      const why = missing ? ` <details class="why inline"><summary>why</summary><span class="hint">${lines.join('<br>')}</span></details>` : '';
      const d = ct.ok > 0 ? an.rawStats(c) : null;
      return `<tr><th scope="row">${esc(m.name)}</th><td class="num">${nf(ct.ok)}</td><td class="num">${nf(missing)}${why}</td>`
        + `<td class="num">${d ? stat(d.median) : DASH}</td><td class="num">${d && d.q1 !== null ? `${fmt4(d.q1)}–${fmt4(d.q3!)}` : DASH}</td><td class="num">${d ? stat(d.skewness) : DASH}</td>${sx ? sexCells(an, c, ct.ok > 0) : ''}</tr>`;
    }).join('');
    return `<tbody><tr class="scat"><th colspan="${cols}" scope="colgroup">${esc(label)}</th></tr>${body}</tbody>`;
  }).join('');
  return `<p class="notice">${nf(n)} participants. Median, IQR and skewness describe the values as selected under Orientation, before any transform. Skewness is the adjusted Fisher–Pearson coefficient (G1).${sx ? ' Median (men) and Median (women) use rows with a recognised sex; hover for n.' : ''}</p>
<div class="table-wrap"><table class="summary stats"><caption class="sr">Calculated and missing counts and summary statistics per index</caption>
<thead><tr><th scope="col">Index</th><th scope="col">N calculated</th><th scope="col">N missing</th><th scope="col">Median</th><th scope="col">IQR (q1–q3)</th><th scope="col">Skewness</th>${sx ? '<th scope="col">Median (men)</th><th scope="col">Median (women)</th>' : ''}</tr></thead>${rows}</table></div>`;
}

// ---------- Distributions ----------
export interface DistUi {
  sel: number | undefined; all: boolean;
  /** Plot type (default density). */
  kind?: 'density' | 'hist';
  /** Split by sex (default on when the file has recognised sex values). */
  split?: boolean;
  /** Add the combined "All" curve to a sex-split density plot. */
  combined?: boolean;
}

const GROUP_NAME = { male: 'men', female: 'women', all: 'all' } as const;
const raf = (f: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => f()) : setTimeout(f, 16));

function transformNote(tr: { nonPositive: number; reasons: string[]; noGroup: number }, t: TransformSetting): string {
  const parts: string[] = [];
  if (t.kind === 'log' && tr.nonPositive > 0) parts.push(`${nf(tr.nonPositive)} values ≤ 0 set to missing for log`);
  if (tr.reasons.length) parts.push(tr.reasons.join('; '));
  if (t.bySex && tr.noGroup > 0) parts.push(`${nf(tr.noGroup)} rows without a recognised sex set to missing`);
  return parts.join('; ');
}

function kindHint(kind: 'density' | 'hist', split: boolean): string {
  const marks = split ? 'Short vertical mark = median of each group (men solid blue, women dashed orange, all dotted grey).' : 'Short vertical mark = median.';
  return kind === 'density'
    ? `Gaussian kernel density, bandwidth bw.nrd0 for each curve, 256 grid points (above 20,000 values the kernel sum uses linearly binned data). ${marks}`
    : `Bins: Freedman–Diaconis rule (Sturges when IQR = 0), 10 to 60 bins${split ? ', shared by both sexes' : ''}. ${split ? marks : 'Dashed line = median.'}`;
}

export function mountDistributions(host: HTMLElement, an: Analysis, counts: Counts, getTf: () => TransformSetting, ui: DistUi): void {
  const tf = getTf();
  const calc = grouped().map(([label, cs]) => [label, cs.filter((c) => counts[INCLUDED[c]!.id]!.ok > 0)] as [string, number[]]).filter(([, cs]) => cs.length);
  const all = calc.flatMap(([, cs]) => cs);
  const div = document.createElement('div');
  host.replaceChildren(div);
  if (!all.length) { div.innerHTML = '<p>No index could be calculated, so there is nothing to plot.</p>'; return; }
  if (ui.sel === undefined || !all.includes(ui.sel)) ui.sel = all[0];
  const sel = ui.sel!;
  const kind = ui.kind ?? 'density';
  const hasSex = an.hasSex;
  const split = hasSex && (ui.split ?? true);
  const combined = split && kind === 'density' && !!ui.combined;
  const files = new Map<string, { svg: string; name: string }>();
  const fig = (key: string, svg: string, name: string) => {
    files.set(key, { svg, name });
    return `<figure class="plot"><div class="svgbox">${svg}</div><figcaption><button type="button" data-dl="${esc(key)}">Download SVG</button></figcaption></figure>`;
  };
  const stem = kind === 'density' ? 'density' : 'hist';
  const suffix = tf.kind === 'none' ? 'raw' : `${tf.kind}${tf.bySex ? '_bysex' : ''}`;
  const opts = calc.map(([label, cs]) => `<optgroup label="${esc(label)}">${cs.map((c) => `<option value="${c}"${c === sel ? ' selected' : ''}>${esc(INCLUDED[c]!.name)}</option>`).join('')}</optgroup>`).join('');

  /** Groups to draw for index c under setting t: one curve, or men / women (plus the combined one when asked). */
  const groupsOf = (): Array<'male' | 'female' | 'all'> => (!split ? ['all'] : combined ? ['male', 'female', 'all'] : ['male', 'female']);
  const curvesOf = (c: number, t: TransformSetting, single: string): Curve[] => groupsOf().map((g) => {
    const d = an.density(c, t, g);
    const style = !split ? { label: 'All', colour: single, dash: '', width: 2 } : GROUP_STYLE[g];
    return { ...style, n: d.n, x: d.kde.x, y: d.kde.y, bw: d.kde.bw, median: d.median };
  });
  const plot = (c: number, t: TransformSetting, o: { title: string; xLabel: string; colour: string; note?: string; small?: boolean }): string => {
    const tr = an.transformed(c, t);
    if (!split) {
      if (kind === 'hist') return histogramSvg({ values: tr.values, xLabel: o.xLabel, title: o.title, colour: o.colour, total: an.total, note: o.note, small: o.small });
      const cu = curvesOf(c, t, o.colour);
      return densitySvg({ curves: cu, xLabel: o.xLabel, title: o.title, total: an.total, n: cu[0]!.n, note: o.note, small: o.small });
    }
    const sp = an.sexSplit(c, t), n = sp.male.length + sp.female.length + sp.noSex;
    if (kind === 'hist') {
      return histogramGroupsSvg({
        groups: [{ ...GROUP_STYLE.male, values: sp.male }, { ...GROUP_STYLE.female, values: sp.female }],
        xLabel: o.xLabel, title: o.title, total: an.total, n, sexMissing: sp.noSex, note: o.note, small: o.small,
      });
    }
    return densitySvg({ curves: curvesOf(c, t, o.colour), xLabel: o.xLabel, title: o.title, total: an.total, n, sexMissing: sp.noSex, note: o.note, small: o.small });
  };

  let body: string;
  if (ui.all) {
    body = '<p class="hint" id="up-dist-status" role="status">Calculating…</p><div class="smalls" id="up-dist-grid"></div><p class="hint" id="up-dist-foot"></p>';
  } else {
    const m = INCLUDED[sel]!;
    let figs = fig('raw', plot(sel, NO_TRANSFORM, { title: 'Raw', xLabel: m.name, colour: OKABE_ITO.blue }), `isat-${stem}-${m.id}-raw.svg`);
    if (tf.kind !== 'none') {
      const tr = an.transformed(sel, tf);
      figs += fig('tr', plot(sel, tf, {
        title: `Transformed: ${KIND_LABEL[tf.kind]}${tf.bySex ? ', within sex' : ''}`, xLabel: transformedLabel(m.name, tf),
        colour: OKABE_ITO.vermillion, note: transformNote(tr, tf),
      }), `isat-${stem}-${m.id}-${suffix}.svg`);
    }
    body = `<div class="plots">${figs}</div><p class="hint">${kindHint(kind, split)}</p>`;
  }
  const radio = (v: 'density' | 'hist', label: string) => `<label class="inline"><input type="radio" name="up-dist-kind" value="${v}"${kind === v ? ' checked' : ''}> ${label}</label>`;
  const sexCtl = hasSex
    ? `\n<label class="inline"><input type="checkbox" id="up-dist-split"${split ? ' checked' : ''}> Split by sex</label>${split && kind === 'density' ? `\n<label class="inline"><input type="checkbox" id="up-dist-comb"${combined ? ' checked' : ''}> Show combined</label>` : ''}`
    : '';
  div.innerHTML = `<p class="actions"><label for="up-dist-sel">Index</label> <select id="up-dist-sel">${opts}</select>
<label class="inline"><input type="checkbox" id="up-dist-all"${ui.all ? ' checked' : ''}> Show all</label>
<span role="radiogroup" aria-label="Plot type">${radio('density', 'Density')} ${radio('hist', 'Histogram')}</span>${sexCtl}
<button type="button" id="up-dist-csv">Download density data (CSV)</button></p>${body}`;
  const again = () => mountDistributions(host, an, counts, getTf, ui);
  div.querySelector('#up-dist-sel')!.addEventListener('change', (e) => { ui.sel = Number((e.target as HTMLSelectElement).value); again(); });
  div.querySelector('#up-dist-all')!.addEventListener('change', (e) => { ui.all = (e.target as HTMLInputElement).checked; again(); });
  div.querySelectorAll<HTMLInputElement>('input[name="up-dist-kind"]').forEach((r) => r.addEventListener('change', () => { ui.kind = r.value as 'density' | 'hist'; again(); }));
  div.querySelector('#up-dist-split')?.addEventListener('change', (e) => { ui.split = (e.target as HTMLInputElement).checked; again(); });
  div.querySelector('#up-dist-comb')?.addEventListener('change', (e) => { ui.combined = (e.target as HTMLInputElement).checked; again(); });
  div.querySelector('#up-dist-csv')!.addEventListener('click', () => {
    const m = INCLUDED[sel]!;
    const mk = (scale: string, t: TransformSetting) => ({
      index: m.name, scale,
      curves: groupsOf().map((g) => ({ g, d: an.density(sel, t, g) })).filter(({ d }) => d.kde.x.length > 1)
        .map(({ g, d }) => ({ group: GROUP_NAME[g], n: d.n, kde: d.kde })),
    });
    const rows = [mk('raw', NO_TRANSFORM)];
    if (tf.kind !== 'none') rows.push(mk(`${KIND_LABEL[tf.kind]}${tf.bySex ? ', within sex' : ''}`, tf));
    saveBlob(new Blob([densityCsv(rows)], { type: 'text/csv;charset=utf-8' }), `isat-density-${m.id}-${suffix}.csv`);
  });
  wireDownloads(div, files);

  if (ui.all) {
    const grid = div.querySelector<HTMLElement>('#up-dist-grid')!;
    const status = div.querySelector<HTMLElement>('#up-dist-status')!;
    const foot = div.querySelector<HTMLElement>('#up-dist-foot')!;
    const total = all.length;
    let k = 0;
    // Draw the small multiples in time slices so the page stays responsive on large files.
    const step = () => {
      if (host.firstChild !== div) return; // superseded by a newer render
      const t0 = performance.now();
      do {
        const c = all[k++]!, m = INCLUDED[c]!;
        const svg = plot(c, tf, { title: m.name, xLabel: m.name, colour: tf.kind === 'none' ? OKABE_ITO.blue : OKABE_ITO.vermillion, small: true });
        files.set(`s${c}`, { svg, name: `isat-${stem}-${m.id}-${suffix}.svg` });
        grid.insertAdjacentHTML('beforeend', `<figure class="plot"><div class="svgbox">${svg}</div><figcaption><button type="button" data-dl="s${c}">Download SVG</button></figcaption></figure>`);
      } while (k < total && performance.now() - t0 < 30);
      if (k < total) { status.textContent = `Calculating… ${k} of ${total}`; raf(step); return; }
      status.remove();
      foot.innerHTML = `${tf.kind === 'none' ? 'Raw values' : `Transformed values (${esc(KIND_LABEL[tf.kind])}${tf.bySex ? ', within sex' : ''})`} for every calculated index. ${kindHint(kind, split)}`;
    };
    step();
  }
}

// ---------- Correlations ----------
export interface CorUi { pair: [number, number] | undefined }

export function mountCorrelations(host: HTMLElement, an: Analysis, getTf: () => TransformSetting, ui: CorUi): void {
  const tf = getTf();
  const div = document.createElement('div');
  host.replaceChildren(div);
  const render = () => {
    if (host.firstChild !== div) return; // superseded by a newer render
    const m = an.matrix(tf);
    const files = new Map<string, { svg: string; name: string }>();
    const tfName = tf.kind === 'none' ? 'raw values' : `${KIND_LABEL[tf.kind]}${tf.bySex ? ', within sex' : ''}`;
    if (m.k < 2) { div.innerHTML = '<p>Fewer than 2 indices have at least 3 non-missing values, so no correlations can be shown.</p>'; return; }
    const heat = heatmapSvg({ labels: m.labels, rho: m.rho, n: m.n, title: 'Spearman correlation between indices', subtitle: tfName[0]!.toUpperCase() + tfName.slice(1) });
    files.set('heat', { svg: heat, name: 'isat-spearman-heatmap.svg' });
    div.innerHTML = `<p class="notice">Spearman rank correlation, pairwise complete cases, for indices with at least 3 non-missing values (${m.k} shown). Spearman correlation depends only on ranks, so z-score and RINT leave it unchanged unless "within sex" is selected; log also removes values ≤ 0. Click a cell to see the scatter plot.</p>
<p class="actions"><button type="button" data-dl="heat">Download SVG</button> <button type="button" id="up-cor-csv">Download correlation matrix (CSV)</button> <button type="button" id="up-cor-n">Download pairwise n (CSV)</button></p>
<div class="heat-wrap" id="up-heat">${heat}</div>
<div id="up-scatter" aria-live="polite"></div>`;
    const sc = div.querySelector<HTMLElement>('#up-scatter')!;
    const show = (ci: number, cj: number) => {
      ui.pair = [ci, cj];
      const i = m.cols.indexOf(ci), j = m.cols.indexOf(cj);
      const xs = an.transformed(cj, tf).values, ys = an.transformed(ci, tf).values;
      const rho = m.rho[i * m.k + j]!, n = m.n[i * m.k + j]!;
      const xl = transformedLabel(INCLUDED[cj]!.name, tf), yl = transformedLabel(INCLUDED[ci]!.name, tf);
      const svg = scatterSvg({ x: xs, y: ys, xLabel: xl, yLabel: yl, rho: Number.isNaN(rho) ? null : rho, n });
      files.set('sc', { svg, name: `isat-scatter-${INCLUDED[ci]!.id}-vs-${INCLUDED[cj]!.id}.svg` });
      sc.innerHTML = `<h3>Scatter plot</h3><figure class="plot"><div class="svgbox">${svg}</div><figcaption><button type="button" data-dl="sc">Download SVG</button></figcaption></figure>`;
    };
    const pick = (t: EventTarget | null) => {
      const r = (t as HTMLElement).closest<SVGElement>('.heat-cell');
      if (!r) return;
      const i = Number(r.dataset['i']), j = Number(r.dataset['j']);
      if (i === j) { sc.innerHTML = '<p class="hint">Choose a cell off the diagonal to compare two different indices.</p>'; return; }
      show(m.cols[i]!, m.cols[j]!);
    };
    div.querySelector('#up-heat')!.addEventListener('click', (e) => pick(e.target));
    div.querySelector('#up-heat')!.addEventListener('keydown', (e) => { const k = (e as KeyboardEvent).key; if (k === 'Enter' || k === ' ') { e.preventDefault(); pick(e.target); } });
    div.querySelector('#up-cor-csv')!.addEventListener('click', () => saveBlob(new Blob([matrixCsv(m, an.mode, 'rho')], { type: 'text/csv;charset=utf-8' }), 'isat-spearman-matrix.csv'));
    div.querySelector('#up-cor-n')!.addEventListener('click', () => saveBlob(new Blob([matrixCsv(m, an.mode, 'n')], { type: 'text/csv;charset=utf-8' }), 'isat-spearman-n.csv'));
    wireDownloads(div, files);
    if (ui.pair && m.cols.includes(ui.pair[0]) && m.cols.includes(ui.pair[1])) show(ui.pair[0], ui.pair[1]);
  };
  if (an.hasMatrix(tf) || an.total * 33 < 2e5) { render(); return; }
  div.innerHTML = '<p role="status">Calculating…</p>';
  setTimeout(render, 0);
}

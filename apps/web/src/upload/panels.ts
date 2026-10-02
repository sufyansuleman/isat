// Result tabs for an uploaded file: Summary, Distributions and Correlations (Participants stays in view.ts).
import { esc, fmt4 } from '../calculate/format';
import { saveBlob } from '../calculate/plots';
import { heatmapSvg, histogramSvg, OKABE_ITO, scatterSvg } from '../calculate/svg';
import {
  Analysis, CATEGORIES, KIND_LABEL, matrixCsv, transformedLabel, type TransformSetting,
} from './analysis';
import { INCLUDED, topReasons, type Counts } from './batch';

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
export function summaryHtml(an: Analysis, counts: Counts, n: number): string {
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
        + `<td class="num">${d ? stat(d.median) : DASH}</td><td class="num">${d && d.q1 !== null ? `${fmt4(d.q1)}–${fmt4(d.q3!)}` : DASH}</td><td class="num">${d ? stat(d.skewness) : DASH}</td></tr>`;
    }).join('');
    return `<tbody><tr class="scat"><th colspan="6" scope="colgroup">${esc(label)}</th></tr>${body}</tbody>`;
  }).join('');
  return `<p class="notice">${nf(n)} participants. Median, IQR and skewness describe the values as selected under Orientation, before any transform. Skewness is the adjusted Fisher–Pearson coefficient (G1).</p>
<div class="table-wrap"><table class="summary stats"><caption class="sr">Calculated and missing counts and summary statistics per index</caption>
<thead><tr><th scope="col">Index</th><th scope="col">N calculated</th><th scope="col">N missing</th><th scope="col">Median</th><th scope="col">IQR (q1–q3)</th><th scope="col">Skewness</th></tr></thead>${rows}</table></div>`;
}

// ---------- Distributions ----------
export interface DistUi { sel: number | undefined; all: boolean }

function transformNote(tr: { nonPositive: number; reasons: string[]; noGroup: number }, t: TransformSetting): string {
  const parts: string[] = [];
  if (t.kind === 'log' && tr.nonPositive > 0) parts.push(`${nf(tr.nonPositive)} values ≤ 0 set to missing for log`);
  if (tr.reasons.length) parts.push(tr.reasons.join('; '));
  if (t.bySex && tr.noGroup > 0) parts.push(`${nf(tr.noGroup)} rows without a recognised sex set to missing`);
  return parts.join('; ');
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
  const files = new Map<string, { svg: string; name: string }>();
  const fig = (key: string, svg: string, name: string) => {
    files.set(key, { svg, name });
    return `<figure class="plot"><div class="svgbox">${svg}</div><figcaption><button type="button" data-dl="${esc(key)}">Download SVG</button></figcaption></figure>`;
  };
  const suffix = tf.kind === 'none' ? 'raw' : `${tf.kind}${tf.bySex ? '_bysex' : ''}`;
  const opts = calc.map(([label, cs]) => `<optgroup label="${esc(label)}">${cs.map((c) => `<option value="${c}"${c === sel ? ' selected' : ''}>${esc(INCLUDED[c]!.name)}</option>`).join('')}</optgroup>`).join('');
  let body: string;
  if (ui.all) {
    body = `<div class="smalls">${all.map((c) => {
      const m = INCLUDED[c]!;
      const tr = an.transformed(c, tf);
      const svg = histogramSvg({ values: tr.values, xLabel: m.name, title: m.name, colour: tf.kind === 'none' ? OKABE_ITO.blue : OKABE_ITO.vermillion, total: an.total, small: true });
      return fig(`s${c}`, svg, `isat-hist-${m.id}-${suffix}.svg`);
    }).join('')}</div>
<p class="hint">${tf.kind === 'none' ? 'Raw values' : `Transformed values (${esc(KIND_LABEL[tf.kind])}${tf.bySex ? ', within sex' : ''})`} for every calculated index. Dashed line = median.</p>`;
  } else {
    const m = INCLUDED[sel]!;
    const rawSvg = histogramSvg({ values: an.raw(sel), xLabel: m.name, title: 'Raw', colour: OKABE_ITO.blue, total: an.total });
    let figs = fig('raw', rawSvg, `isat-hist-${m.id}-raw.svg`);
    if (tf.kind !== 'none') {
      const tr = an.transformed(sel, tf);
      const svg = histogramSvg({
        values: tr.values, xLabel: transformedLabel(m.name, tf), title: `Transformed: ${KIND_LABEL[tf.kind]}${tf.bySex ? ', within sex' : ''}`,
        colour: OKABE_ITO.vermillion, total: an.total, note: transformNote(tr, tf),
      });
      figs += fig('tr', svg, `isat-hist-${m.id}-${suffix}.svg`);
    }
    body = `<div class="plots">${figs}</div><p class="hint">Dashed line = median. Bins: Freedman–Diaconis rule (Sturges when IQR = 0), 10 to 60 bins.</p>`;
  }
  div.innerHTML = `<p class="actions"><label for="up-dist-sel">Index</label> <select id="up-dist-sel">${opts}</select>
<label class="inline"><input type="checkbox" id="up-dist-all"${ui.all ? ' checked' : ''}> Show all</label></p>${body}`;
  div.querySelector('#up-dist-sel')!.addEventListener('change', (e) => { ui.sel = Number((e.target as HTMLSelectElement).value); mountDistributions(host, an, counts, getTf, ui); });
  div.querySelector('#up-dist-all')!.addEventListener('change', (e) => { ui.all = (e.target as HTMLInputElement).checked; mountDistributions(host, an, counts, getTf, ui); });
  wireDownloads(div, files);
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

import { CANONICAL, orient, toUnit, type ConversionSettings, type Inputs, type OrientMode } from '@isat/core';
import { clean } from '../calculate/format';
import { hydrateFormulas } from '../calculate/mathml';
import { drawChart, downloadPng, seriesPoints, type Chart } from '../calculate/plots';
import { aucHtml, cardsHtml, resultsFooterHtml, type Snapshot } from '../calculate/results';
import { emptyState, type FormState, type UnitChoice } from '../calculate/state';
import { ISAT_VERSION } from '../version';
import { runRow, type AvignonUse } from './batch';

/** Canonical Inputs -> form state in the user's units, so the manual-mode renderer can be reused. */
export function stateFromInputs(i: Inputs, units: UnitChoice, settings: Partial<ConversionSettings>, factors: { insulin: string; glucose: string }): FormState {
  const st = emptyState(units);
  st.insulinFactor = factors.insulin; st.glucoseFactor = factors.glucose;
  const conv = (v: number, q: 'glucose' | 'insulin' | 'ffa' | 'tg' | 'hdl') => clean(toUnit(v, q, CANONICAL[q], units[q], settings));
  const times = new Set<number>();
  for (const s of [i.glucose, i.insulin]) for (const [t, v] of Object.entries(s ?? {})) if (typeof v === 'number') times.add(Number(t));
  st.rows = [...times].sort((a, b) => a - b).map((t) => ({
    time: String(t),
    glucose: typeof i.glucose?.[t] === 'number' ? conv(i.glucose[t]!, 'glucose') : '',
    insulin: typeof i.insulin?.[t] === 'number' ? conv(i.insulin[t]!, 'insulin') : '',
  }));
  const f0 = i.ffa?.[0];
  if (typeof f0 === 'number') st.ffa = conv(f0, 'ffa');
  if (i.tg !== undefined) st.tg = conv(i.tg, 'tg');
  if (i.hdl !== undefined) st.hdl = conv(i.hdl, 'hdl');
  for (const k of ['age', 'weight', 'bmi', 'waist', 'fat_mass', 'rate_glycerol', 'rate_palmitate'] as const) {
    if (i[k] !== undefined) st[k] = String(i[k]);
  }
  if (i.sex) st.sex = i.sex;
  return st;
}

/** Full single-person view (cards, plots, AUC, footer) built with the manual-mode renderers. Returns a disposer. */
export function renderPerson(
  host: HTMLElement, inputs: Inputs, units: UnitChoice, settings: Partial<ConversionSettings>,
  factors: { insulin: string; glucose: string }, av: AvignonUse, mode: OrientMode,
): () => void {
  const st = stateFromInputs(inputs, units, settings, factors);
  const snap: Snapshot = {
    state: st, built: { inputs, settings, errors: {} }, results: runRow(inputs, settings, av),
    calculatedAt: new Date(), version: ISAT_VERSION,
  };
  host.innerHTML = `<div class="cards" data-part="cards"></div><h3>OGTT plots</h3><div class="plots" data-part="plots"></div><div data-part="auc"></div><div data-part="foot"></div>`;
  const part = (n: string) => host.querySelector<HTMLElement>(`[data-part="${n}"]`)!;
  part('cards').innerHTML = cardsHtml(orient(snap.results, mode), snap);
  hydrateFormulas(part('cards'));
  part('auc').innerHTML = aucHtml(inputs, st, settings);
  part('foot').innerHTML = resultsFooterHtml(snap);
  const charts: Chart[] = [];
  (['glucose', 'insulin'] as const).forEach((q, n) => {
    const pts = seriesPoints(st, q);
    const wrap = document.createElement('figure');
    wrap.className = 'plot';
    part('plots').appendChild(wrap);
    const label = q === 'glucose' ? 'Glucose' : 'Insulin';
    if (pts.t.length === 0) { wrap.textContent = `${label}: no values.`; return; }
    const chart = drawChart(wrap, pts, label, units[q], n === 0 ? '--series-1' : '--series-2');
    charts.push(chart);
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = `Download PNG (${label.toLowerCase()})`;
    b.addEventListener('click', () => downloadPng(chart, `isat-${q}.png`));
    wrap.appendChild(b);
  });
  return () => charts.forEach((c) => c.destroy());
}

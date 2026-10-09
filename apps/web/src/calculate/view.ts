import { countEvent } from '../count';
import { calculateAll, orient, type OrientMode, type Result } from '@isat/core';
import { ISAT_VERSION } from '../version';
import { esc } from './format';
import { exampleState } from './example';
import { buildInputs, emptyState, settingsOf, type FormState, type UnitChoice } from './state';
import {
  aucHtml, availabilityHtml, notCalculatedHtml, orientationNoteHtml, summaryHtml, wireSummary, csvText, resultsFooterHtml, unitLabel, type Snapshot,
} from './results';
import { hydrateFormulas } from './mathml';
import { unitsSectionHtml } from './units';
import { drawChart, downloadPng, saveBlob, seriesPoints, type Chart } from './plots';
import { fieldHint, seriesHint } from './hints';

const opt = (v: string, cur: string, label = unitLabel(v)) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;

function field(key: string, label: string, hint = ''): string {
  return `<div class="field"><label for="f-${key}">${label}</label>
<input id="f-${key}" data-f="${key}" type="text" inputmode="decimal" autocomplete="off" placeholder="-" aria-describedby="e-${key}">
<span class="hint">${hint}</span><span class="err" id="e-${key}" role="alert"></span></div>`;
}

function formHtml(st: FormState): string {
  return `
${unitsSectionHtml(st.units, "m")}
<p class="hint">Changing a unit changes how your typed numbers are interpreted; it does not rewrite them.</p>

<section aria-labelledby="h-table"><h2 id="h-table">Glucose and insulin: fasting and OGTT</h2>
<p>Row 0 is the fasting sample, taken before the 75 g oral glucose drink. Other rows are minutes after the drink. For fasting-only data, fill row 0 and leave the others empty.</p>
<p class="hint">Grey values (e.g. 5.0) are examples for a typical healthy adult. They are only a guide and are not used unless you type them in.</p>
<div class="table-wrap"><table class="ogtt"><thead><tr>
<th scope="col">Time (min)</th><th scope="col">Glucose (<span data-ul="glucose"></span>)</th><th scope="col">Insulin (<span data-ul="insulin"></span>)</th><th scope="col"><span class="sr">Remove row</span></th>
</tr></thead><tbody id="rows"></tbody></table></div>
<p><button type="button" id="add-row">Add row</button></p>
<p class="hint">Leave a cell empty if it was not measured; empty is treated as missing, never as 0.</p>
</section>

<section aria-labelledby="h-other"><h2 id="h-other">Lipids and anthropometrics</h2>
<div class="grid">
${field('tg', 'Triglycerides (fasting)')}${field('hdl', 'HDL cholesterol (fasting)')}${field('ffa', 'Free fatty acids (fasting)')}
${field('age', 'Age (years)')}
<div class="field"><label for="f-sex">Sex</label><select id="f-sex" data-f="sex"><option value="">not given</option><option value="male">male</option><option value="female">female</option></select><span class="hint"></span></div>
${field('weight', 'Weight (kg)')}${field('height', 'Height (cm), optional', 'used only to derive BMI when BMI is empty')}
${field('bmi', 'BMI (kg/m²)')}${field('waist', 'Waist (cm)')}
</div>
<p id="bmi-note" class="hint" aria-live="polite"></p>
<details class="factors"><summary>Advanced: tracer / DXA</summary>
<p class="hint">Tracer rates are used in the units you supply.</p>
<div class="grid">${field('fat_mass', 'Fat mass (kg)')}${field('rate_glycerol', 'Glycerol Ra')}${field('rate_palmitate', 'Palmitate Ra')}</div>
</details>
</section>

<p class="actions sticky-actions"><button type="button" class="primary" id="calc">Calculate</button>
<button type="button" id="example">Load example</button> <button type="button" id="clear">Clear</button></p>
<p id="calc-msg" class="err" role="alert"></p>

<section aria-label="Indices available with the values entered" class="avail-box">
<div id="avail"></div></section>

<section id="results" aria-labelledby="h-res" hidden><h2 id="h-res">Results</h2>
<p class="hint">Results update automatically when you change the inputs.</p>
<fieldset class="orient"><legend>Orientation</legend>
<label><input type="radio" name="orient" value="published" checked> Published direction</label>
<label><input type="radio" name="orient" value="sensitivity"> InsuSensCalc convention (resistance indices negated, _inv)</label>
${orientationNoteHtml()}
</fieldset>
<h3>OGTT plots</h3>
<div id="plots" class="plots"></div>
<h3>Summary</h3>
<div id="summary"></div>
<div id="not-calc"></div>
<div id="auc"></div>
<div id="foot"></div>
<p><button type="button" id="csv">Download results CSV</button></p>
</section>`;
}

export function mountCalculate(root: HTMLElement): () => void {
  let st: FormState = emptyState();
  let snap: Snapshot | undefined;
  let charts: Chart[] = [];
  let orientMode: OrientMode = 'published';
  const openCards = new Set<string>();
  let autoTimer: ReturnType<typeof setTimeout> | undefined;
  root.innerHTML = formHtml(st);
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;

  // ----- DOM <-> state -----
  function renderRows(): void {
    $('#rows').innerHTML = st.rows.map((r, k) => {
      const time = k === 0
        ? `<span class="fasting-label">0 min: fasting (before glucose drink)</span>`
        : `<input data-r="${k}" data-c="time" type="text" inputmode="decimal" aria-label="Minutes after drink, row ${k + 1}" value="${esc(r.time)}" placeholder="-" autocomplete="off"> <span class="after">min after drink</span><span class="err" data-e="row:${k}:time"></span>`;
      const rm = k === 0 ? '' : `<button type="button" data-rm="${k}" aria-label="Remove row ${k + 1}">Remove</button>`;
      return `<tr><td>${time}</td>
<td><input data-r="${k}" data-c="glucose" type="text" inputmode="decimal" aria-label="Glucose, ${k === 0 ? 'fasting' : `row ${k + 1}`}" value="${esc(r.glucose)}" placeholder="-" autocomplete="off"><span class="err" data-e="row:${k}:glucose"></span></td>
<td><input data-r="${k}" data-c="insulin" type="text" inputmode="decimal" aria-label="Insulin, ${k === 0 ? 'fasting' : `row ${k + 1}`}" value="${esc(r.insulin)}" placeholder="-" autocomplete="off"><span class="err" data-e="row:${k}:insulin"></span></td>
<td>${rm}</td></tr>`;
    }).join('');
  }
  function writeFields(): void {
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-f]').forEach((el) => {
      el.value = (st as unknown as Record<string, string>)[el.dataset['f']!] ?? '';
    });
    root.querySelectorAll<HTMLSelectElement>('[data-u]').forEach((el) => { el.value = st.units[el.dataset['u'] as keyof UnitChoice]; });
    root.querySelectorAll<HTMLSelectElement>('[data-x]').forEach((el) => {
      el.value = (st as unknown as Record<string, string>)[el.dataset['x']!]!;
    });
    renderRows();
  }
  function refreshLabels(): void {
    root.querySelectorAll<HTMLElement>('[data-ul]').forEach((el) => { el.textContent = unitLabel(st.units[el.dataset['ul'] as 'glucose' | 'insulin']); });
    const hints: Record<string, string> = { tg: st.units.tg, hdl: st.units.hdl, ffa: st.units.ffa };
    for (const [k, u] of Object.entries(hints)) $(`#f-${k}`).parentElement!.querySelector('.hint')!.textContent = unitLabel(u);
  }

  /** Grey example values ("e.g. …") in empty fields, converted to the selected units. */
  function refreshHints(): void {
    root.querySelectorAll<HTMLInputElement>('input[data-f]').forEach((el) => { el.placeholder = fieldHint(el.dataset['f']!, st.units); });
    root.querySelectorAll<HTMLInputElement>('input[data-r][data-c="glucose"], input[data-r][data-c="insulin"]').forEach((el) => {
      const row = st.rows[Number(el.dataset['r'])];
      const t = row && row.time.trim() !== '' ? Number(row.time) : NaN;
      el.placeholder = seriesHint(el.dataset['c'] as 'glucose' | 'insulin', t, st.units);
    });
  }

  function refresh(): void {
    refreshLabels();
    refreshHints();
    const built = buildInputs(st);
    root.querySelectorAll<HTMLElement>('.err[id^="e-"], .err[data-e]').forEach((el) => {
      const key = el.dataset['e'] ?? el.id.slice(2);
      const msg = built.errors[key] ?? '';
      el.textContent = msg;
      const inp = el.parentElement?.querySelector('input');
      if (inp) inp.setAttribute('aria-invalid', msg ? 'true' : 'false');
    });
    $('#bmi-note').textContent = built.bmiFromHeight !== undefined
      ? `BMI from height and weight: ${Number(built.bmiFromHeight.toPrecision(4))} kg/m² (will be used because BMI is empty)` : '';
    const results = calculateAll(built.inputs, { settings: built.settings });
    // Live update on every keystroke: keep the details block open if the user opened it.
    const wasOpen = root.querySelector<HTMLDetailsElement>('#av-details')?.open ?? false;
    $('#avail').innerHTML = availabilityHtml(results);
    if (wasOpen) root.querySelector<HTMLDetailsElement>('#av-details')!.open = true;
    if (snap) { clearTimeout(autoTimer); autoTimer = setTimeout(() => calculate(false), 300); }
  }

  // ----- results -----
  function renderResults(): void {
    if (!snap) return;
    const oriented = orient(snap.results, orientMode);
    $('#results').hidden = false;
    $('#summary').innerHTML = summaryHtml(oriented, snap, openCards);
    hydrateFormulas($('#summary'));
    $('#not-calc').innerHTML = notCalculatedHtml(snap.results);
    $('#foot').innerHTML = resultsFooterHtml(snap);
    $('#auc').innerHTML = aucHtml(snap.built.inputs, snap.state, snap.built.settings);
  }
  function renderPlots(): void {
    charts.forEach((c) => c.destroy()); charts = [];
    const host = $('#plots');
    host.innerHTML = '';
    if (!snap) return;
    (['glucose', 'insulin'] as const).forEach((q, n) => {
      const pts = seriesPoints(snap!.state, q);
      const wrap = document.createElement('figure');
      wrap.className = 'plot';
      const label = q === 'glucose' ? 'Glucose' : 'Insulin';
      if (pts.t.length === 0) { wrap.innerHTML = `<figcaption>${label}: no values entered.</figcaption>`; host.appendChild(wrap); return; }
      host.appendChild(wrap);
      const chart = drawChart(wrap, pts, label, snap!.state.units[q], n === 0 ? '--series-1' : '--series-2');
      charts.push(chart);
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = `Download PNG (${label.toLowerCase()})`;
      b.addEventListener('click', () => downloadPng(chart, `isat-${q}.png`));
      wrap.appendChild(b);
    });
  }

  function calculate(manual = true): void {
    const built = buildInputs(st);
    const msg = $('#calc-msg');
    if (Object.keys(built.errors).length) { msg.textContent = 'Fix the highlighted entries before calculating.'; return; }
    msg.textContent = '';
    const results: Result[] = calculateAll(built.inputs, { settings: built.settings });
    if (manual) countEvent('single-calculation');
    snap = {
      state: structuredClone(st), built, results, calculatedAt: new Date(), version: ISAT_VERSION,
    };
    renderResults();
    renderPlots();
    if (manual) $('#results').scrollIntoView();
  }

  // ----- events -----
  root.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset['r'] !== undefined) {
      (st.rows[Number(el.dataset['r'])] as unknown as Record<string, string>)[el.dataset['c']!] = el.value;
    } else if (el.dataset['f']) (st as unknown as Record<string, string>)[el.dataset['f']] = el.value;
    else return;
    refresh();
  });
  root.addEventListener('change', (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.dataset['u']) (st.units as unknown as Record<string, string>)[el.dataset['u']] = el.value;
    else if (el.dataset['x']) (st as unknown as Record<string, string>)[el.dataset['x']] = el.value;
    else if (el.dataset['f']) { (st as unknown as Record<string, string>)[el.dataset['f']] = el.value; }
    else if (el.name === 'orient') { orientMode = el.value as OrientMode; renderResults(); return; }
    else return;
    refresh();
  });
  root.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('button');
    if (!el) return;
    if (el.id === 'add-row') { st.rows.push({ time: '', glucose: '', insulin: '' }); renderRows(); refresh(); }
    else if (el.dataset["rm"] !== undefined && el.dataset["rm"] !== "0") { st.rows.splice(Number(el.dataset['rm']), 1); renderRows(); refresh(); }
    else if (el.id === 'calc') calculate();
    else if (el.id === 'show-why') {
      const d = root.querySelector<HTMLDetailsElement>('#av-details');
      if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); }
    }
    else if (el.id === 'clear') { st = { ...emptyState(st.units), insulinFactor: st.insulinFactor, glucoseFactor: st.glucoseFactor }; clearTimeout(autoTimer); openCards.clear(); snap = undefined; $('#results').hidden = true; $('#calc-msg').textContent = ''; writeFields(); refresh(); }
    else if (el.id === 'example') { st = exampleState(st.units, st); writeFields(); refresh(); }
    else if (el.id === 'csv' && snap) {
      saveBlob(new Blob([csvText(orient(snap.results, orientMode), snap)], { type: 'text/csv;charset=utf-8' }), 'isat-results.csv');
    }
  });

  wireSummary($('#summary'), openCards);
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => renderPlots();
  mq.addEventListener('change', onScheme);

  void settingsOf;
  writeFields();
  refresh();
  return () => { clearTimeout(autoTimer); charts.forEach((c) => c.destroy()); mq.removeEventListener('change', onScheme); };
}

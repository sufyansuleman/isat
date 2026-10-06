import { countEvent, rowBand } from '../count';
import type { Inputs, OrientMode } from '@isat/core';
import { esc } from '../calculate/format';
import { saveBlob } from '../calculate/plots';
import { DEFAULT_UNITS, type UnitChoice } from '../calculate/state';
import { unitsSectionHtml } from '../calculate/units';
import { ISAT_VERSION } from '../version';
import {
  composeCsv, emptyCounts, INCLUDED, mergeCounts, settingsFile,
  type AvignonChoice, type AvignonUse, type ChunkPayload, type Counts, type RunRequest, type WorkerMessage,
} from '@isat/core';
import { checkFileSize, checkRowCount, hasAllowedExtension } from '@isat/core';
import { Analysis, NO_TRANSFORM, transformExplanation, transformSuffix, type TransformSetting } from './analysis';
import { mountCorrelations, mountDistributions, summaryHtml, type CorUi, type DistUi } from './panels';
import { loadTable, toCanonical, type Loaded } from '@isat/core';
import { checkUnits, warningText, type UnitCheckItem } from '@isat/core';
import { unitLabel } from '../calculate/results';
import { renderPerson } from './person';
import { exampleDetailsHtml, exampleFile } from './example';

type TabId = 'summary' | 'dist' | 'cor' | 'people';
const TABS: Array<[TabId, string]> = [['summary', 'Summary'], ['dist', 'Distributions'], ['cor', 'Correlations'], ['people', 'Participants']];

interface Run {
  canonical: Inputs[];
  units: UnitChoice;
  factors: { insulin: string; glucose: string };
  settings: { glucose_mg_per_dL_per_mmol: number; insulin_pmol_per_uU: number };
  av: AvignonUse;
  counts: Counts;
  chunks: ChunkPayload[];
  fileName: string;
  delimiter: string;
  withProblems: number;
  unitCheck: UnitCheckItem[];
  finishedAt: string;
}

const html = `
<section aria-labelledby="up-h-file"><h2 id="up-h-file">Upload a file</h2>
<div id="up-drop" class="drop">
  <p><label for="up-file">Choose a .csv or .tsv file</label> (<a href="isat-template.csv" download>Download an example file</a>)
  <input id="up-file" type="file" accept=".csv,.tsv"></p>
  <p class="hint">or drop it here. The file is read in this browser and is not uploaded. Limit: 100,000 rows / 25 MB; for larger cohorts use the Linux command-line tool (in preparation).</p>
</div>
<p id="up-err" class="err" role="alert"></p>
${exampleDetailsHtml()}
<p class="hint">One row per person. Recognised columns (any case): participant_id (or id), age, sex, weight, bmi, waist, TG, HDL_c, FFA, G0 to G120 (or fasting_glucose, glucose_30 …), I0 to I120 (or fasting_insulin, insulin_30 …), fat_mass, rate_glycerol, rate_palmitate. Use a dot as the decimal separator. Sex: 1/2, m/f or male/female (1 = male, 2 = female). Values must be in the units chosen below.</p>
</section>
<div id="up-loaded" hidden></div>
<section id="up-results" aria-labelledby="up-h-res" hidden></section>`;

/** Summary line for the collapsed column-mapping table. */
export function columnMappingSummary(columns: Array<{ kind: string }>): { text: string; notRecognised: number } {
  const notRecognised = columns.filter((c) => c.kind === 'ignored').length;
  return {
    text: `${columns.length - notRecognised} of ${columns.length} columns recognised${notRecognised ? ` — ${notRecognised} not recognised` : ''}`,
    notRecognised,
  };
}

export function mountUpload(root: HTMLElement): () => void {
  root.innerHTML = html;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  let loaded: Loaded | undefined;
  let fileName = '';
  let units: UnitChoice = { ...DEFAULT_UNITS };
  const factors = { insulin: '6', glucose: '18' };
  let avChoice: AvignonChoice = 'default';
  let worker: Worker | undefined;
  let run: Run | undefined;
  let orientMode: OrientMode = 'published';
  let includeStatus = false;
  let disposePerson: (() => void) | undefined;
  let openIndex: number | undefined;
  const tf: TransformSetting = { ...NO_TRANSFORM };
  let addTransformed = true;
  let tab: TabId = 'summary';
  let analysis: Analysis | undefined;
  let distUi: DistUi = { sel: undefined, all: false };
  let corUi: CorUi = { pair: undefined };

  const stopWorker = () => { worker?.terminate(); worker = undefined; };

  // ---------- loading ----------
  async function loadFile(file: File): Promise<void> {
    $('#up-err').textContent = '';
    if (!hasAllowedExtension(file.name)) { $('#up-err').textContent = 'Only .csv and .tsv files are accepted.'; return; }
    const size = checkFileSize(file.size);
    if (!size.ok) { $('#up-err').textContent = size.message; return; }
    const text = await file.text();
    const rows = checkRowCount(text);
    if (!rows.ok) { $('#up-err').textContent = rows.message; return; }
    const l = loadTable(text);
    if (l.total === 0) { $('#up-err').textContent = 'No data rows found in the file.'; return; }
    stopWorker(); resetResults();
    loaded = l; fileName = file.name;
    renderLoaded();
    countEvent(`file-uploaded-${rowBand(l.total)}`);
  }

  function renderLoaded(): void {
    const l = loaded!;
    const idCol = l.columns.find((c) => c.kind === 'id');
    const recognised = l.columns.filter((c) => c.kind === 'variable').length;
    const shown = (c: (typeof l.columns)[number]) => c.kind === "ignored" ? "ignored" : esc(c.variable ?? "") + (c.canonical && c.canonical.toLowerCase() !== c.name.trim().toLowerCase() ? ` (${esc(c.canonical)})` : "");
    const map = l.columns.map((c) => `<tr><td>${esc(c.name)}</td><td>${shown(c)}</td></tr>`).join("");
    const { text: mapSummary, notRecognised } = columnMappingSummary(l.columns);
    const mapOpen = notRecognised > 0 || l.fileErrors.length > 0;
    const blocked = recognised === 0 || l.fileErrors.length > 0;
    const probs = l.problems.slice(0, 20).map((p) => `<li>Row ${p.row} (${esc(p.id)}): ${p.messages.map(esc).join('; ')}</li>`).join('');
    const cols = l.header.map((h) => `<th scope="col">${esc(h)}</th>`).join('');
    const prev = l.preview.map((r) => `<tr>${l.header.map((_, k) => `<td>${esc(r[k] ?? '')}</td>`).join('')}</tr>`).join('');
    $('#up-loaded').hidden = false;
    $('#up-loaded').innerHTML = `
<section aria-labelledby="up-h-file2"><h2 id="up-h-file2">File</h2>
<ul>
<li>${esc(fileName)}: ${l.total.toLocaleString('en-GB')} participants.</li>
<li>Delimiter detected: ${l.delimiter}.</li>
<li>${idCol ? `Participant IDs from column "${esc(idCol.name)}", kept exactly as text.` : 'No participant_id column found; IDs generated as row_1, row_2, ...'}</li>
${l.duplicateIds.length ? `<li class="warn">Warning: ${l.duplicateIds.length} duplicate ID${l.duplicateIds.length > 1 ? 's' : ''} (for example ${esc(l.duplicateIds.slice(0, 3).join(', '))}).</li>` : ''}
${recognised === 0 ? '<li class="err">No recognised data columns. Check the column names.</li>' : ''}
${l.fileErrors.map((e) => `<li class="err">${esc(e)}.</li>`).join("")}
</ul>
</section>
<div id="up-units">${unitsSectionHtml(units, 'u', { title: 'Units used in your file', intro: 'Choose the units used in your file. All rows must use the same units.' })}<div id="up-unitcheck" role="status"></div></div>
<section aria-label="Column mapping">
<details class="map-details"${mapOpen ? ' open' : ''}><summary>${mapSummary}</summary>
<div class="table-wrap"><table class="ogtt"><thead><tr><th scope="col">Column</th><th scope="col">Recognised as</th></tr></thead><tbody>${map}</tbody></table></div></details>
</section>
<section aria-labelledby="up-h-av"><h2 id="up-h-av">Avignon SiM weight</h2>
<fieldset class="orient"><legend>Coefficient</legend>
<label><input type="radio" name="up-av" value="default"${avChoice === 'default' ? ' checked' : ''}> Published coefficient 0.137 (default)</label>
<label><input type="radio" name="up-av" value="cohort"${avChoice === 'cohort' ? ' checked' : ''}> Derived from this cohort (InsuSensCalc / Suleman 2024)</label>
</fieldset></section>
<section aria-labelledby="up-h-val"><h2 id="up-h-val">Validation</h2>
<p><strong>${l.rowsWithProblems}</strong> of ${l.total.toLocaleString('en-GB')} rows have problems. Cells with problems are treated as missing; those rows are still calculated.</p>
${probs ? `<ul>${probs}</ul>${l.rowsWithProblems > 20 ? `<p class="hint">Showing the first 20 rows with problems.</p>` : ''}` : ''}
<h3>Preview (first ${l.preview.length} rows)</h3>
<div class="table-wrap"><table class="ogtt"><thead><tr>${cols}</tr></thead><tbody>${prev}</tbody></table></div>
</section>
<p class="actions"><button type="button" class="primary" id="up-calc"${blocked ? " disabled" : ""}>Calculate</button></p>
<div id="up-progress-box" hidden>
<p><progress id="up-progress" max="100" value="0" aria-label="Progress"></progress> <span id="up-progress-text" aria-live="polite"></span>
<button type="button" id="up-cancel">Cancel</button></p></div>`;
    $<HTMLSelectElement>('#u-u-glucose').value = units.glucose;
    $<HTMLSelectElement>('#u-u-insulin').value = units.insulin;
    $<HTMLSelectElement>('#u-u-tg').value = units.tg;
    $<HTMLSelectElement>('#u-u-hdl').value = units.hdl;
    $<HTMLSelectElement>('#u-u-ffa').value = units.ffa;
    $<HTMLSelectElement>('#u-x-insulin').value = factors.insulin;
    $<HTMLSelectElement>('#u-x-glucose').value = factors.glucose;
    renderUnitCheck();
  }

  function renderUnitCheck(): void {
    const warn = checkUnits(loaded!.inputs, units).filter((i) => i.suggested !== null);
    $('#up-unitcheck').innerHTML = warn.map((i) => `<p class="warn unitwarn">${esc(warningText(i))} <button type="button" data-uc="${i.quantity}" data-to="${esc(i.suggested!)}">Switch to ${esc(unitLabel(i.suggested!))}</button></p>`).join('');
  }

  function resetResults(): void {
    disposePerson?.(); disposePerson = undefined; openIndex = undefined; run = undefined; analysis = undefined;
    distUi = { sel: undefined, all: false }; corUi = { pair: undefined }; tab = 'summary';
    $('#up-results').hidden = true; $('#up-results').innerHTML = '';
  }

  // ---------- calculation ----------
  function startRun(): void {
    if (loaded!.fileErrors.length) return;
    const l = loaded!;
    resetResults();
    const settings = { glucose_mg_per_dL_per_mmol: Number(factors.glucose), insulin_pmol_per_uU: Number(factors.insulin) };
    const canonical = l.inputs.map((i) => toCanonical(i, units, settings));
    const cur: Run = {
      canonical, units: { ...units }, factors: { ...factors }, settings,
      av: { w: 0.137, source: 'avignon_1999', warnings: [] }, counts: emptyCounts(), chunks: [], fileName,
      delimiter: l.delimiter, withProblems: l.rowsWithProblems, unitCheck: checkUnits(l.inputs, units), finishedAt: '',
    };
    const box = $('#up-progress-box'), bar = $<HTMLProgressElement>('#up-progress'), txt = $('#up-progress-text');
    box.hidden = false; bar.max = canonical.length; bar.value = 0; txt.textContent = `0 / ${canonical.length.toLocaleString('en-GB')}`;
    $<HTMLButtonElement>('#up-calc').disabled = true;
    stopWorker();
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker = w;
    w.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.type === 'weight') cur.av = m.use;
      else if (m.type === 'chunk') {
        cur.chunks.push(m.payload); mergeCounts(cur.counts, m.counts);
        bar.value = m.done; txt.textContent = `${m.done.toLocaleString('en-GB')} / ${m.total.toLocaleString('en-GB')}`;
      } else if (m.type === 'done') {
        stopWorker(); box.hidden = true; $<HTMLButtonElement>('#up-calc').disabled = false;
        cur.finishedAt = new Date().toISOString(); run = cur; renderResults();
        countEvent(`file-analysed-${rowBand(loaded!.total)}`);
      } else if (m.type === 'error') {
        stopWorker(); box.hidden = true; $<HTMLButtonElement>('#up-calc').disabled = false;
        $('#up-err').textContent = `Calculation failed: ${m.message}`;
      }
    };
    w.onerror = () => { stopWorker(); box.hidden = true; $<HTMLButtonElement>('#up-calc').disabled = false; $('#up-err').textContent = 'The calculation worker failed to start.'; };
    const req: RunRequest = { type: 'run', rows: canonical, ids: l.ids, problems: l.rowProblems, settings, avignon: avChoice };
    w.postMessage(req);
  }

  function cancelRun(): void {
    stopWorker();
    $('#up-progress-box').hidden = true;
    $<HTMLButtonElement>('#up-calc').disabled = false;
    $('#up-err').textContent = 'Calculation cancelled. No results were kept.';
  }

  // ---------- results ----------
  const effTf = (): TransformSetting => ({ kind: tf.kind, bySex: tf.kind !== 'none' && tf.bySex });
  const sexes = (): Array<string | null> => loaded!.inputs.map((i) => i.sex ?? null);
  const hasSexColumn = () => loaded!.columns.some((c) => c.kind === 'variable' && c.variable === 'sex');

  function getAnalysis(): Analysis {
    if (!analysis || analysis.mode !== orientMode) analysis = new Analysis(run!.chunks, orientMode, sexes());
    return analysis;
  }

  function renderResults(): void {
    const r = run!, l = loaded!;
    const n = l.total;
    const avText = `Avignon SiM weight ${r.av.w} (${r.av.source === 'sample' ? 'derived from this cohort' : 'Avignon 1999'}).`;
    const res = $('#up-results');
    const sexOk = hasSexColumn() && sexes().some((s) => s !== null);
    if (!sexOk) tf.bySex = false;
    const sexNote = !hasSexColumn() ? 'No sex column in this file.' : !sexOk ? 'No recognised sex values in this file.' : '';
    const kindLabel = { none: 'None', log: 'Natural log', z: 'z-score', rint: 'Rank-based inverse normal (RINT, Blom)' };
    res.hidden = false;
    res.innerHTML = `<h2 id="up-h-res">Results</h2>
<p>${n.toLocaleString('en-GB')} participants calculated. ${esc(avText)} Belfiore indices use the belfiore_1998 reference set. Surrogate indices; not direct measurements of insulin sensitivity and not a diagnosis.</p>
<fieldset class="orient"><legend>Orientation (applies to the analysis tabs, the download and the participant view)</legend>
<label><input type="radio" name="up-orient" value="published"${orientMode === 'published' ? ' checked' : ''}> Published direction</label>
<label><input type="radio" name="up-orient" value="sensitivity"${orientMode === 'sensitivity' ? ' checked' : ''}> InsuSensCalc convention (resistance indices negated, _inv)</label>
</fieldset>
<fieldset class="orient"><legend>Transform (applies to Distributions, Correlations and the results CSV)</legend>
<p class="check"><label for="up-tf">Transform</label> <select id="up-tf">${(['none', 'log', 'z', 'rint'] as const).map((k) => `<option value="${k}"${tf.kind === k ? ' selected' : ''}>${esc(kindLabel[k])}</option>`).join('')}</select>
<label class="inline"><input type="checkbox" id="up-bysex"${tf.bySex ? ' checked' : ''}${sexOk ? '' : ' disabled'}> within sex</label>
<span class="hint" id="up-sex-note">${esc(sexNote)}</span></p>
<p class="hint" id="up-tf-explain"></p>
<div id="up-tf-excl"></div>
</fieldset>
<p class="check"><label><input type="checkbox" id="up-status"${includeStatus ? ' checked' : ''}> include per-method status columns</label></p>
<p class="check" id="up-addtf-wrap"><label><input type="checkbox" id="up-addtf"${addTransformed ? ' checked' : ''}> Add transformed columns</label></p>
<p class="actions"><button type="button" id="up-csv">Download results CSV</button> <button type="button" id="up-json">Download settings file (JSON)</button></p>
<div class="tabs" role="tablist" aria-label="Results">${TABS.map(([id, label]) => `<button type="button" role="tab" id="up-tabbtn-${id}" data-tab="${id}" aria-controls="up-tab-${id}" aria-selected="${id === tab}" tabindex="${id === tab ? 0 : -1}">${label}</button>`).join('')}</div>
${TABS.map(([id]) => `<div role="tabpanel" id="up-tab-${id}" aria-labelledby="up-tabbtn-${id}"${id === tab ? '' : ' hidden'} class="tabpanel"></div>`).join('')}`;
    $('#up-tab-people').innerHTML = `<p><label for="up-search">Search by ID</label> <input id="up-search" type="search" autocomplete="off"></p>
<p class="hint" id="up-list-note"></p>
<ul id="up-list" class="plist"></ul>
<div id="up-person" tabindex="-1"></div>`;
    renderList();
    updateTfUi();
    showTab(tab);
  }

  function updateTfUi(): void {
    const t = effTf();
    let text = transformExplanation(t);
    if (t.bySex) {
      const s = sexes();
      const k = (v: string) => s.filter((x) => x === v).length;
      text += ` Male n = ${k('male').toLocaleString('en-GB')}; female n = ${k('female').toLocaleString('en-GB')}; ${s.filter((x) => x === null).length.toLocaleString('en-GB')} rows without a recognised sex are set to missing.`;
    }
    $('#up-tf-explain').textContent = text;
    $('#up-addtf-wrap').hidden = tf.kind === 'none';
    let excl = '';
    if (tf.kind === 'log') {
      const an = getAnalysis();
      const items = INCLUDED.map((m, c) => [m, an.nonPositive(c)] as const).filter(([m, k]) => k > 0 && run!.counts[m.id]!.ok > 0);
      if (items.length) {
        excl = `<details class="why"><summary>Values ≤ 0 in ${items.length} index${items.length === 1 ? '' : 'es'}</summary><ul class="av-list">${items.map(([m, k]) => `<li>${esc(m.name)}: ${k.toLocaleString('en-GB')} values ≤ 0 set to missing for log</li>`).join('')}</ul></details>`;
      }
    }
    $('#up-tf-excl').innerHTML = excl;
  }

  function showTab(id: TabId): void {
    tab = id;
    root.querySelectorAll<HTMLElement>('[role="tab"][data-tab]').forEach((b) => {
      const on = b.dataset['tab'] === id;
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    });
    root.querySelectorAll<HTMLElement>('.tabpanel').forEach((p) => { p.hidden = p.id !== `up-tab-${id}`; });
    const host = $(`#up-tab-${id}`);
    if (id === 'summary') host.innerHTML = summaryHtml(getAnalysis(), run!.counts, loaded!.total);
    else if (id === 'dist') mountDistributions(host, getAnalysis(), run!.counts, effTf, distUi);
    else if (id === 'cor') mountCorrelations(host, getAnalysis(), effTf, corUi);
  }

  function renderList(): void {
    const l = loaded!;
    const q = $<HTMLInputElement>('#up-search').value.trim().toLowerCase();
    const hits: number[] = [];
    for (let k = 0; k < l.ids.length && hits.length < 100; k++) if (q === '' || l.ids[k]!.toLowerCase().includes(q)) hits.push(k);
    $('#up-list').innerHTML = hits.map((k) => `<li><button type="button" data-p="${k}">${esc(l.ids[k]!)}</button></li>`).join('');
    $('#up-list-note').textContent = `Showing ${hits.length === 100 ? 'the first 100 matches' : `${hits.length} match${hits.length === 1 ? '' : 'es'}`}.`;
  }

  function openPerson(k: number): void {
    const r = run!;
    openIndex = k;
    disposePerson?.();
    const host = $('#up-person');
    host.innerHTML = `<h3>Participant ${esc(loaded!.ids[k]!)} (row ${k + 1})</h3><div id="up-person-body"></div>`;
    disposePerson = renderPerson($('#up-person-body'), r.canonical[k]!, r.units, r.settings, r.factors, r.av, orientMode);
    host.focus();
  }

  // ---------- events ----------
  root.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (el.id === 'up-file') { const f = (el as HTMLInputElement).files?.[0]; if (f) void loadFile(f); return; }
    if (el.dataset['u']) { (units as unknown as Record<string, string>)[el.dataset['u']] = el.value; if (loaded) renderUnitCheck(); return; }
    if (el.dataset['x']) { factors[el.dataset['x'] === 'insulinFactor' ? 'insulin' : 'glucose'] = el.value; return; }
    if (el.name === 'up-av') { avChoice = el.value as AvignonChoice; return; }
    if (el.name === 'up-orient') {
      orientMode = el.value as OrientMode; analysis = undefined;
      if (openIndex !== undefined) openPerson(openIndex);
      if (run) { updateTfUi(); showTab(tab); }
      return;
    }
    if (el.id === 'up-status') includeStatus = (el as HTMLInputElement).checked;
    else if (el.id === 'up-addtf') addTransformed = (el as HTMLInputElement).checked;
    else if (el.id === 'up-tf') { tf.kind = el.value as TransformSetting['kind']; updateTfUi(); showTab(tab); }
    else if (el.id === 'up-bysex') { tf.bySex = (el as HTMLInputElement).checked; updateTfUi(); showTab(tab); }
  });
  root.addEventListener('input', (e) => { if ((e.target as HTMLElement).id === 'up-search') renderList(); });
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset['tab'] !== undefined) showTab(b.dataset['tab'] as TabId);
    else if (b.dataset['uc'] !== undefined) {
      const sel = $<HTMLSelectElement>(`#u-u-${b.dataset['uc']}`);
      sel.value = b.dataset['to']!;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      sel.focus();
    }
    else if (b.id === 'up-calc') startRun();
    else if (b.id === 'up-use-example') { units = { ...DEFAULT_UNITS }; void loadFile(exampleFile()); }
    else if (b.id === 'up-cancel') cancelRun();
    else if (b.dataset['p'] !== undefined) openPerson(Number(b.dataset['p']));
    else if (b.id === 'up-csv' && run) {
      const t = effTf();
      const extra = t.kind !== 'none' && addTransformed ? { suffix: transformSuffix(t), cols: getAnalysis().transformedColumns(t) } : undefined;
      saveBlob(new Blob(composeCsv(run.chunks, orientMode, includeStatus, extra), { type: 'text/csv;charset=utf-8' }), 'isat-results.csv');
    } else if (b.id === 'up-json' && run) {
      const doc = settingsFile({
        version: ISAT_VERSION, timestamp: run.finishedAt, fileName: run.fileName, delimiter: run.delimiter,
        units: { ...run.units, insulin_factor_pmol_per_uU: run.factors.insulin, glucose_factor_mg_per_dL_per_mmol: run.factors.glucose },
        settings: run.settings, avignon: run.av, orientation: orientMode, includeStatus,
        unitCheck: run.unitCheck,
        rows: { total: loaded!.total, withProblems: run.withProblems, calculated: loaded!.total },
        transform: { kind: effTf().kind, withinSex: effTf().bySex, addedColumns: tf.kind !== 'none' && addTransformed, suffix: transformSuffix(effTf()) },
      });
      saveBlob(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), 'isat-settings.json');
    }
  });
  const drop = $('#up-drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('over');
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) void loadFile(f);
  });

  return () => { stopWorker(); disposePerson?.(); };
}

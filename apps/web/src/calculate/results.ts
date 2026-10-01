import { registry, methodSpecs, toUnit, summarize, type Inputs, type Result, type Unit } from '@isat/core';
import { esc, fmt4 } from './format';
import type { Built, FormState } from './state';

// ---------- spec access (YAML-derived, includes grouped files) ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Spec = Record<string, any>;
const flat: Record<string, Spec> = {};
for (const spec of Object.values(methodSpecs) as unknown as Spec[]) {
  if (Array.isArray(spec.methods)) {
    const { methods, ...group } = spec;
    for (const m of methods) flat[m.id] = { ...group, ...m };
  } else flat[spec.id] = spec;
}
export const specFor = (id: string): Spec => flat[id] ?? {};
export const baseId = (id: string) => id.replace(/_inv$/, '');

/** "Derived in" line: population, N and study centre as reported in the original paper. */
export function derivedHtml(spec: Spec): string {
  const d = spec.derived_in;
  if (!d) return '';
  const where = d.setting ? `; ${esc(d.setting)}` : '';
  return `<p class="derived"><strong>Derived in:</strong> ${esc(d.population)} (N = ${esc(d.n)})${where}.</p>`;
}

export interface Snapshot {
  state: FormState;
  built: Built;
  results: Result[]; // raw (published orientation) results from calculateAll
  calculatedAt: Date;
  version: string;
}

export const unitLabel = (u: string) => u.replace('uU/mL', 'µU/mL').replace('umol/L', 'µmol/L');

// ---------- availability panel ----------
export function availabilityHtml(results: Result[]): string {
  const included = registry.filter((m) => m.deferredReason === undefined);
  const byId = new Map(results.map((r) => [r.id, r]));
  const ok = included.filter((m) => byId.get(m.id)?.status === 'ok');
  const notOk = included.filter((m) => byId.get(m.id)?.status !== 'ok').map((m) => {
    const r = byId.get(m.id);
    const why = r?.reasons.join('; ') ?? 'no result';
    return `<li>${esc(m.name)}: <span class="av-state">${r?.status === 'error' ? 'error, ' : ''}${esc(why)}</span></li>`;
  });
  return `<p class="av-summary"><strong>${ok.length} of ${included.length} indices can be calculated</strong> with the values entered.</p>
<details class="av-details" id="av-details"><summary>Show which and why</summary>
<p><strong>Calculated:</strong> ${ok.length ? ok.map((m) => esc(m.name)).join(', ') : 'none yet'}.</p>
${notOk.length ? `<p><strong>Not calculated:</strong></p><ul class="av-list">${notOk.join('')}</ul>` : ''}
</details>`;
}

/** One line under the results pointing to the reasons for indices that were not calculated. */
export function notCalculatedHtml(results: Result[]): string {
  const included = new Set(registry.filter((m) => m.deferredReason === undefined).map((m) => m.id));
  const n = results.filter((r) => included.has(r.id) && r.status !== 'ok').length;
  return n ? `<p class="hint">${n} ${n === 1 ? 'index' : 'indices'} not calculated with these values. <button type="button" class="linklike" id="show-why">See why</button></p>` : '';
}

// ---------- inputs used (values as entered, in the user's units) ----------
function unitFor(q: string, st: FormState): string | undefined {
  if (q === 'glucose' || q === 'insulin' || q === 'ffa' || q === 'tg' || q === 'hdl') return st.units[q];
  return { weight: 'kg', fat_mass: 'kg', waist: 'cm', bmi: 'kg/m²', age: 'years' }[q];
}

function enteredSeries(st: FormState, q: 'glucose' | 'insulin', t: number): string | undefined {
  for (const r of st.rows) if (r.time.trim() !== '' && Number(r.time) === t && r[q].trim() !== '') return r[q].trim();
  return undefined;
}

export function usedInputs(id: string, r: Result, snap: Snapshot): string[] {
  const st = snap.state;
  const spec = specFor(id);
  const out: string[] = [];
  const times = (all: 'glucose' | 'insulin') =>
    st.rows.filter((x) => x[all].trim() !== '' && x.time.trim() !== '').map((x) => Number(x.time)).sort((a, b) => a - b);
  const seen = new Set<string>();
  for (const item of (spec.inputs ?? []) as Array<string | { var: string }>) {
    const tok = typeof item === "string" ? item : item.var;
    const m = /^(glucose|insulin|ffa)(?:_([\d,]+))?/.exec(tok.trim());
    if (m) {
      const q = m[1] as 'glucose' | 'insulin' | 'ffa';
      let ts: number[];
      if (q === 'ffa') ts = [0];
      else if (m[2]) ts = m[2].split(',').map(Number);
      else ts = times(q);
      if (id.startsWith('belfiore_isi') && q !== 'ffa' && (r.details?.['variant'] === '0_1_2h')) ts = [0, 60, 120];
      for (const t of ts) {
        const raw = q === 'ffa' ? st.ffa.trim() : enteredSeries(st, q, t);
        const key = `${q}${t}`;
        if (raw && !seen.has(key)) { seen.add(key); out.push(`${t === 0 ? `${q}, fasting` : `${q} at ${t} min`}: ${esc(raw)} ${esc(unitLabel(st.units[q]))}`); }
      }
      continue;
    }
    const name = tok.trim().split(/[\s(]/)[0]!;
    if (seen.has(name)) continue;
    seen.add(name);
    if (name === 'sex') { if (st.sex) out.push(`sex: ${st.sex}`); continue; }
    if (name === 'bmi' && snap.built.bmiFromHeight !== undefined && st.bmi.trim() === '') {
      out.push(`BMI from height and weight: ${fmt4(snap.built.bmiFromHeight)} kg/m²`); continue;
    }
    const raw = (st as unknown as Record<string, string>)[name === 'tg' ? 'tg' : name === 'hdl' ? 'hdl' : name];
    if (typeof raw === 'string' && raw.trim() !== '') {
      const u = unitFor(name, st);
      const label = name.startsWith('rate_') ? `${name.replace('_', ' ')} (as supplied)` : name;
      out.push(`${esc(label)}: ${esc(raw.trim())}${u && !name.startsWith('rate_') ? ' ' + esc(unitLabel(u)) : ''}`);
    }
  }
  return out;
}

// ---------- extras ----------
const BADGE: Record<string, string> = {
  directly_verified: 'Verified against original publication',
  secondary_source_confirmed: 'Confirmed via secondary sources',
  author_verified_not_rechecked: 'Verified by InsuSensCalc author; not re-checked',
  reconstructed_from_original_method: 'Reconstructed from the original method; not checked against the paper',
  unresolved: 'Source unresolved',
  not_applicable: 'Not applicable',
};
export const badgeText = (sv: string) => BADGE[sv] ?? sv;

const DIRECTION: Record<string, string> = {
  higher_more_sensitive: 'higher = more insulin-sensitive',
  higher_more_resistant: 'higher = more insulin-resistant',
  unknown: 'direction not specified',
};

function referenceHtml(r: Result, st: FormState, settings: Built['settings']): string {
  const rs = r.details?.['reference_set'] as { name: string | null; values: Record<string, number> | null } | undefined;
  if (!rs) return '';
  const id = baseId(r.id);
  const variant = String(r.details?.['variant'] ?? '');
  const form = String(r.details?.['form'] ?? '');
  const area = form === 'area' || (id === 'belfiore_isi_gly');
  const suf = area ? `_area_${variant === '0_2h' ? '0_2h' : '0_1_2h'}` : '_0';
  const qs = id === 'belfiore_isi_ffa' ? (area ? ['insulin', 'ffa'] : ['insulin', 'ffa']) : id === 'belfiore_isi_gly' ? ['insulin', 'glucose'] : ['insulin', 'glucose'];
  const items = qs.map((q) => {
    const v = rs.values?.[`${q}${suf}`];
    if (v === undefined) return '';
    const canon = ({ glucose: 'mmol/L', insulin: 'pmol/L', ffa: 'mmol/L' } as const)[q as 'glucose'];
    const u = st.units[q as 'glucose'] as Unit;
    const shown = toUnit(v, q as 'glucose', canon as Unit, u, settings);
    return `<li>${q}${area ? ' area' : ' basal'}: ${fmt4(shown)} ${esc(unitLabel(u))}${area ? '·h' : ''}</li>`;
  }).join('');
  const label = rs.name === 'belfiore_1998' ? 'belfiore_1998 (Belfiore 1998 reference means)' : esc(rs.name ?? 'custom');
  return `<div class="extra"><strong>Reference set:</strong> ${label}<ul>${items}</ul></div>`;
}

function citationHtml(spec: Spec): string {
  const ref = spec.reference ?? (typeof spec.source === 'object' ? spec.source : undefined);
  const text: string | undefined = ref?.citation ?? (typeof spec.source === 'string' ? spec.source : undefined);
  if (!text) return '<p class="cite">Citation: not recorded in the method file.</p>';
  const ids: string[] = [];
  if (ref?.doi) ids.push(`DOI: <a href="https://doi.org/${esc(ref.doi)}">${esc(ref.doi)}</a>`);
  if (ref?.pmid) ids.push(`PMID: ${esc(ref.pmid)}`);
  return `<p class="cite">${esc(text)}${ids.length ? ' ' + ids.join('; ') : ''}</p>`;
}

// ---------- cards ----------
export function cardHtml(r: Result, snap: Snapshot): string {
  const id = baseId(r.id);
  const m = registry.find((x) => x.id === id);
  const spec = specFor(id);
  const name = m?.name ?? id;
  const head = `<h3>${esc(name)}</h3>`;
  if (r.status === 'error') {
    return `<article class="card card-error" data-id="${esc(r.id)}" data-status="error">${head}
<p class="err-msg"><strong>Error:</strong> ${esc(r.reasons.join('; '))}</p></article>`;
  }
  const v = r.value as number;
  const inputs = usedInputs(id, r, snap);
  const warns = r.warnings.map((w) => `<li>${esc(w)}</li>`).join('');
  const lims = ((spec.limitations ?? []) as string[]).map((l) => `<li>${esc(l)}</li>`).join('');
  const sv = m?.source_verification ?? spec.source_verification;
  const extra: string[] = [];
  const note = r.details?.['orientation_note'];
  if (typeof note === 'string') extra.push(`<p class="extra">${esc(note)}</p>`);
  if (id === 'avignon_sim') {
    const w = r.details?.['weight'] as number | undefined;
    const src = r.details?.['weight_source'];
    const srcText = src === 'avignon_1999' ? 'Avignon 1999' : src === 'sample' ? 'sample-derived' : 'user-supplied';
    if (w !== undefined) extra.push(`<p class="extra">weight ${w} (${srcText})</p>`);
  }
  extra.push(referenceHtml(r, snap.state, snap.built.settings));
  return `<article class="card" data-id="${esc(r.id)}" data-status="ok">${head}
<p class="value"><span class="num" data-full="${v}">${fmt4(v)}</span>${r.unit ? ` <span class="unit">${esc(r.unit)}</span>` : ''}</p>
<p class="dir">${DIRECTION[r.direction] ?? ''}</p>
${cardFormulaHtml(spec, snap.state.sex)}
<p><span class="badge" data-sv="${esc(sv)}">${esc(badgeText(sv))}</span></p>
${extra.join('')}
${inputs.length ? `<div class="extra"><strong>Inputs used:</strong><ul>${inputs.map((i) => `<li>${i}</li>`).join('')}</ul></div>` : ''}
${warns ? `<div class="extra warn"><strong>Warnings:</strong><ul>${warns}</ul></div>` : ''}
${lims ? `<div class="extra"><strong>Limitations:</strong><ul>${lims}</ul></div>` : ''}
${citationHtml(spec)}
<details><summary>Verification note</summary><p>${esc(m?.source_verification_detail ?? '')}</p></details>
${derivedHtml(spec)}
<p class="method-link"><a href="#/methods/${esc(id)}">Method details</a></p>
</article>`;
}

/** Formula block for a card; sex-specific variants (VAI, LAP) are all shown, the one used is highlighted. */
export function cardFormulaHtml(spec: Spec, sex: '' | 'male' | 'female'): string {
  const formula = (latex: string) =>
    `<div class="formula" aria-label="Formula" data-latex="${esc(latex)}"><code>${esc(latex)}</code></div>`;
  const variants = (spec.formula_variants ?? []) as Array<{ label: string; latex: string }>;
  if (variants.length) {
    const usedLabel = sex === 'male' ? 'Men' : sex === 'female' ? 'Women' : '';
    return variants.map((v) => {
      const used = v.label === usedLabel;
      return `<div class="variant${used ? ' variant-used' : ''}"><span class="vlabel">${esc(v.label)}${used ? ' (used)' : ''}</span>${formula(v.latex)}</div>`;
    }).join('');
  }
  return spec.formula_latex ? formula(spec.formula_latex) : '';
}

export function cardsHtml(oriented: Result[], snap: Snapshot): string {
  const shown = oriented.filter((r) => r.status === 'ok' || r.status === 'error');
  if (!shown.length) return '<p>No method could be calculated with the current inputs. See the availability panel for the reasons.</p>';
  return shown.map((r) => cardHtml(r, snap)).join('\n');
}

export function resultsFooterHtml(snap: Snapshot): string {
  const s = snap.built.settings;
  const f = (x: number | undefined) => (x === undefined ? 'n/a' : String(x));
  const bmi = snap.built.bmiFromHeight !== undefined ? `<p>BMI from height and weight: ${fmt4(snap.built.bmiFromHeight)} kg/m² (used because BMI was not entered).</p>` : '';
  const when = snap.calculatedAt.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  return `<div class="results-foot">
<p>Surrogate indices; not direct measurements of insulin sensitivity and not a diagnosis.</p>
${bmi}
<p>Conversion factors used: glucose ${f(s.glucose_mg_per_dL_per_mmol)} mg/dL per mmol/L; insulin ${f(s.insulin_pmol_per_uU)} pmol/L per µU/mL; TG 88.57 mg/dL per mmol/L; HDL 38.67 mg/dL per mmol/L.</p>
<p>ISAT version ${esc(snap.version)}; calculated ${when}.</p></div>`;
}

// ---------- AUC summary (core summarize, shown in the user's units) ----------
export function aucHtml(inputs: Inputs, st: FormState, settings: Built['settings']): string {
  const sm = summarize(inputs);
  const row = (label: string, q: 'glucose' | 'insulin', canon: Unit) => {
    const s = sm[q];
    const u = st.units[q] as Unit;
    const t = s.time_points.length ? s.time_points.map((x) => (x === 0 ? 'fasting' : String(x))).join(', ') + ' min' : 'none';
    const val = s.auc === null ? `not available (${esc(s.reason ?? '')})` : `${fmt4(toUnit(s.auc, q, canon, u, settings))} ${esc(unitLabel(u))}·min`;
    return `<tr><th scope="row">${label}</th><td>${val}</td><td>${esc(t)}</td></tr>`;
  };
  return `<table class="auc"><caption>Area under the curve (trapezoid over the supplied time points)</caption>
<thead><tr><th scope="col">Curve</th><th scope="col">AUC</th><th scope="col">Time points used</th></tr></thead>
<tbody>${row('Glucose', 'glucose', 'mmol/L')}${row('Insulin', 'insulin', 'pmol/L')}</tbody></table>`;
}

// ---------- CSV ----------
export const CSV_COLUMNS = [
  'method_id', 'name', 'value', 'unit', 'direction', 'orientation', 'source_verification', 'status',
  'warnings', 'glucose_factor', 'insulin_factor', 'isat_version', 'calculated_at',
] as const;

const q = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function csvRows(oriented: Result[], snap: Snapshot): string[][] {
  const s = snap.built.settings;
  return oriented.map((r) => {
    const id = baseId(r.id);
    const m = registry.find((x) => x.id === id);
    return [
      r.id, m?.name ?? id, r.value === null ? '' : String(r.value), r.unit ?? '', r.direction,
      r.orientation ?? 'published', m?.source_verification ?? '', r.status,
      [...r.warnings, ...(r.status === 'ok' ? [] : r.reasons)].join(' | '),
      String(s.glucose_mg_per_dL_per_mmol ?? ''), String(s.insulin_pmol_per_uU ?? ''),
      snap.version, snap.calculatedAt.toISOString(),
    ];
  });
}

export function csvText(oriented: Result[], snap: Snapshot): string {
  return [CSV_COLUMNS.join(','), ...csvRows(oriented, snap).map((r) => r.map(q).join(','))].join('\r\n') + '\r\n';
}

// ---------- summary table (one row per result, grouped by category, full card on demand) ----------
const SUMMARY_GROUPS: Array<[string, string]> = [
  ['fasting', 'Fasting'], ['ogtt', 'OGTT'], ['lipid', 'Lipid & body measures'], ['tracer_dxa', 'Tracer & DXA'],
];
const SHORT_DIRECTION: Record<string, string> = {
  higher_more_sensitive: 'higher = more sensitive',
  higher_more_resistant: 'higher = more resistant',
  unknown: 'not specified',
};

/** Compact table grouped by registry category; each row's full card is hidden until its Details toggle is used. */
export function summaryHtml(oriented: Result[], snap: Snapshot, open: ReadonlySet<string> = new Set()): string {
  const shown = oriented.filter((r) => r.status === 'ok' || r.status === 'error');
  if (!shown.length) return '<p>No method could be calculated with the current inputs. See the availability panel for the reasons.</p>';
  const catOf = (r: Result) => registry.find((x) => x.id === baseId(r.id))?.category ?? '';
  const groups = SUMMARY_GROUPS.map(([k, label]) => [label, shown.filter((r) => catOf(r) === k)] as const);
  const known = new Set(SUMMARY_GROUPS.map(([k]) => k));
  const other = shown.filter((r) => !known.has(catOf(r)));
  if (other.length) groups.push(['Other', other]);
  const rows = groups.filter(([, rs]) => rs.length).map(([label, rs]) => {
    const body = rs.map((r) => {
      const id = esc(r.id);
      const name = esc(registry.find((x) => x.id === baseId(r.id))?.name ?? baseId(r.id));
      const isOpen = open.has(r.id);
      const val = r.status === 'ok'
        ? `<span class="num">${fmt4(r.value as number)}</span>${r.unit ? ` <span class="unit">${esc(r.unit)}</span>` : ''}`
        : '<span class="err-msg">error</span>';
      const dir = r.status === 'ok' ? (SHORT_DIRECTION[r.direction] ?? '') : '';
      return `<tr class="srow" data-row="${id}"><th scope="row">${name}</th><td>${val}</td><td>${dir}</td>
<td><button type="button" class="linklike" data-toggle="${id}" aria-expanded="${isOpen}">Details</button></td></tr>
<tr class="sdetail" data-detail="${id}"${isOpen ? '' : ' hidden'}><td colspan="4">${cardHtml(r, snap)}</td></tr>`;
    }).join('');
    return `<tbody><tr class="scat"><th colspan="4" scope="colgroup">${esc(label)}</th></tr>${body}</tbody>`;
  }).join('');
  return `<p class="actions"><button type="button" data-expand="all">Expand all</button> <button type="button" data-expand="none">Collapse all</button></p>
<div class="table-wrap"><table class="summary"><caption class="sr">Calculated indices by category</caption>
<thead><tr><th scope="col">Index</th><th scope="col">Value</th><th scope="col">Direction</th><th scope="col">Details</th></tr></thead>${rows}</table></div>`;
}

/** Handle Details / Expand all / Collapse all inside `host`; `open` (optional) records which rows are expanded. */
export function wireSummary(host: HTMLElement, open?: Set<string>): void {
  const set = (id: string, on: boolean) => {
    host.querySelectorAll<HTMLElement>('[data-detail]').forEach((d) => { if (d.dataset['detail'] === id) d.hidden = !on; });
    host.querySelectorAll<HTMLElement>('[data-toggle]').forEach((b) => { if (b.dataset['toggle'] === id) b.setAttribute('aria-expanded', String(on)); });
    if (open) { if (on) open.add(id); else open.delete(id); }
  };
  host.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    if (b.dataset['toggle'] !== undefined) set(b.dataset['toggle'], b.getAttribute('aria-expanded') !== 'true');
    else if (b.dataset['expand'] !== undefined) {
      const on = b.dataset['expand'] === 'all';
      host.querySelectorAll<HTMLElement>('[data-toggle]').forEach((t) => set(t.dataset['toggle']!, on));
    }
  });
}

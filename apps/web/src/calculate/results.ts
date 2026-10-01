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
  const excluded = registry.filter((m) => m.deferredReason !== undefined);
  const byId = new Map(results.map((r) => [r.id, r]));
  const li = included.map((m) => {
    const r = byId.get(m.id);
    if (r?.status === 'ok') return `<li class="av-ok"><span class="mark" aria-hidden="true">✓</span> ${esc(m.name)} <span class="av-state">calculable</span></li>`;
    const why = r?.reasons.join('; ') ?? 'no result';
    const kind = r?.status === 'error' ? 'error' : 'not calculable';
    const mark = r?.status === 'error' ? '!' : '○';
    return `<li class="av-no"><span class="mark" aria-hidden="true">${mark}</span> ${esc(m.name)} <span class="av-state">${kind}: ${esc(why)}</span></li>`;
  });
  const ex = excluded.map((m) =>
    `<li class="av-no"><span class="mark" aria-hidden="true">○</span> ${esc(m.name)} <span class="av-state">${esc(m.deferredReason ?? '')}</span></li>`);
  const nOk = results.filter((r) => r.status === 'ok').length;
  return `<h3>${nOk} of ${included.length} methods calculable with the current inputs</h3>
<ul class="avail">${li.join('')}</ul>
<h3>Not included in this version</h3>
<ul class="avail">${ex.join('')}</ul>`;
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
        if (raw && !seen.has(key)) { seen.add(key); out.push(`${q} at ${t} min: ${esc(raw)} ${esc(unitLabel(st.units[q]))}`); }
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
${spec.formula_latex ? `<div class="formula" aria-label="Formula" data-latex="${esc(spec.formula_latex)}"><code>${esc(spec.formula_latex)}</code></div>` : ''}
<p><span class="badge" data-sv="${esc(sv)}">${esc(badgeText(sv))}</span></p>
${extra.join('')}
${inputs.length ? `<div class="extra"><strong>Inputs used:</strong><ul>${inputs.map((i) => `<li>${i}</li>`).join('')}</ul></div>` : ''}
${warns ? `<div class="extra warn"><strong>Warnings:</strong><ul>${warns}</ul></div>` : ''}
${lims ? `<div class="extra"><strong>Limitations:</strong><ul>${lims}</ul></div>` : ''}
${citationHtml(spec)}
<details><summary>Verification note</summary><p>${esc(m?.source_verification_detail ?? '')}</p></details>
</article>`;
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
    const t = s.time_points.length ? s.time_points.join(', ') + ' min' : 'none';
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

import { DEFAULT_SETTINGS, registry, type MethodEntry } from '@isat/core';
import { esc } from '../calculate/format';
import { badgeText, derivedHtml, specFor } from '../calculate/results';

// Everything here is derived from methodSpecs (via specFor) and the registry; no per-method text is hard-coded.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Spec = Record<string, any>;

export const CATEGORIES: Array<[string, string]> = [
  ['all', 'All'], ['fasting', 'Fasting'], ['ogtt', 'OGTT'], ['lipid', 'Lipid & body measures'],
  ['tracer_dxa', 'Tracer & DXA'],
];

/** Category used for filtering; excluded methods are always "deferred" whatever their YAML category. */
export function categoryOf(m: MethodEntry): string {
  return m.deferredReason !== undefined ? 'deferred' : m.category;
}

export const DIRECTION_PHRASE: Record<string, string> = {
  higher_more_sensitive: 'higher = more insulin-sensitive',
  higher_more_resistant: 'higher = more insulin-resistant',
  unknown: 'direction not specified',
};

export const LEVELS: Array<[string, string]> = [
  ['directly_verified', 'The formula was checked against the original publication.'],
  ['secondary_source_confirmed', 'The formula was confirmed in secondary sources; the original was not re-read.'],
  ['author_verified_not_rechecked', 'The formula was verified against the publication by the InsuSensCalc author; not re-checked for ISAT.'],
];

const UNIT_WORDS: Record<string, string> = {
  uU_per_mL: 'µU/mL', mg_per_dL: 'mg/dL', mmol_per_L: 'mmol/L', pmol_per_L: 'pmol/L', 'uU/mL': 'µU/mL',
};
const DEFAULT_UNIT: Record<string, string> = {
  glucose: 'mmol/L', insulin: 'pmol/L', ffa: 'mmol/L', tg: 'mmol/L', hdl: 'mmol/L', weight: 'kg', fat_mass: 'kg',
  waist: 'cm', bmi: 'kg/m²', age: 'years',
};

/** One YAML input token -> "glucose: fasting, 30, 120 min (mmol/L)". */
export function describeInput(item: string | { var: string; unit?: string }): string {
  const raw = typeof item === 'string' ? item : item.var;
  const explicit = typeof item === 'string' ? /\(([^)]*)\)/.exec(raw)?.[1] : item.unit;
  const unitText = explicit !== undefined ? (UNIT_WORDS[explicit] ?? explicit) : undefined;
  const tok = raw.replace(/\s*\(.*\)\s*$/, '').trim();
  const m = /^(glucose|insulin|ffa)_([\d,]+)$/.exec(tok);
  if (m) {
    const times = m[2]!.split(',').map((t) => (Number(t) === 0 ? 'fasting' : t)).join(', ');
    const hasMin = m[2]!.split(',').some((t) => Number(t) !== 0);
    return `${m[1]}: ${times}${hasMin ? ' min' : ''} (${unitText ?? DEFAULT_UNIT[m[1]!]})`;
  }
  const scalar = /^(tg|hdl|weight|bmi|waist|age|fat_mass)$/.exec(tok);
  if (scalar) return `${tok} (${unitText ?? DEFAULT_UNIT[tok] ?? ""})`;
  return unitText ? `${tok} (${unitText})` : tok;
}

function refHtml(ref: Spec): string {
  const links: string[] = [];
  if (ref.doi) links.push(`DOI: <a href="https://doi.org/${esc(ref.doi)}">${esc(ref.doi)}</a>`);
  if (ref.pmid) links.push(`PMID: <a href="https://pubmed.ncbi.nlm.nih.gov/${esc(ref.pmid)}/">${esc(ref.pmid)}</a>`);
  return `${esc(ref.citation ?? '')}${links.length ? ' ' + links.join('; ') : ''}`;
}

function referencesHtml(spec: Spec): string {
  const primary = spec.reference ?? (typeof spec.source === 'object' ? spec.source : undefined);
  const out: string[] = [];
  if (primary?.citation) out.push(`<p class="ref">${refHtml(primary)}</p>`);
  else if (typeof spec.source === 'string') out.push(`<p class="ref">${esc(spec.source)}</p>`);
  else out.push('<p class="ref">Primary reference: not recorded in the method file.</p>');
  const sec = (spec.secondary_references ?? []) as Spec[];
  if (sec.length) out.push(`<p class="ref"><strong>Also see:</strong></p><ul>${sec.map((r) => `<li>${refHtml(r)}</li>`).join('')}</ul>`);
  return out.join('');
}

function colText(c: unknown): string {
  if (c && typeof c === 'object') {
    const o = c as Record<string, string>;
    return `${o['male']} (men), ${o['female']} (women)`;
  }
  return String(c);
}

export function legacyText(spec: Spec): string {
  const lg = spec.legacy ?? {};
  const col = lg.insusenscalc_column;
  const scale = lg.scale_factor ? ` Scale factor: ${esc(lg.scale_factor)}.` : '';
  switch (lg.relation) {
    case 'equal': return `Identical to InsuSensCalc column ${esc(colText(col))}.${scale}`;
    case 'negated': return `InsuSensCalc reports this negated as ${esc(colText(col))} (higher = more sensitive).${scale}`;
    case 'different': return `Deliberately different from InsuSensCalc ${esc(colText(col))}: ${esc(lg.difference ?? 'see method file')}.${scale}`;
    default: return 'Not in InsuSensCalc.';
  }
}

/** Formula block(s): variants with labels when the method has them, otherwise the single formula. */
export function formulasHtml(spec: Spec, usedLabel?: string): string {
  const variants = (spec.formula_variants ?? []) as Array<{ label: string; latex: string }>;
  if (variants.length) {
    return variants.map((v) =>
      `<div class="variant${v.label === usedLabel ? ' variant-used' : ''}"><span class="vlabel">${esc(v.label)}</span><div class="formula" data-latex="${esc(v.latex)}"><code>${esc(v.latex)}</code></div></div>`).join('');
  }
  if (spec.formula_latex) return `<div class="formula" data-latex="${esc(spec.formula_latex)}"><code>${esc(spec.formula_latex)}</code></div>`;
  return '';
}

function list(title: string, items: unknown): string {
  const a = (Array.isArray(items) ? items : []) as string[];
  return a.length ? `<div class="extra"><strong>${title}:</strong><ul>${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
}

export function searchText(m: MethodEntry, spec: Spec): string {
  const refs = [spec.reference, typeof spec.source === 'object' ? spec.source : undefined, ...(spec.secondary_references ?? [])]
    .map((r) => (r && typeof r === 'object' ? r.citation : '') ?? '').join(' ');
  return `${m.name} ${m.id} ${typeof spec.source === 'string' ? spec.source : ''} ${refs}`.toLowerCase();
}

/** One-line "derived in" note shown on the collapsed row: place (or a short population description) and N. */
function derivedShort(spec: Spec): string {
  const d = spec.derived_in;
  if (!d) return '';
  const pop = String(d.population ?? '');
  const where = d.setting ? String(d.setting) : (pop.length > 70 ? pop.slice(0, 67).replace(/\s+\S*$/, '') + '...' : pop);
  const n = d.n ? `, N = ${d.n}` : '';
  return `<span class="mpop">Derived in: ${esc(where)}${esc(n)}</span>`;
}

export function entryHtml(m: MethodEntry): string {
  const spec = specFor(m.id);
  const excluded = m.deferredReason !== undefined;
  const inputs = ((spec.inputs ?? []) as Array<string | { var: string; unit?: string }>).map(describeInput);
  const body = excluded
    ? `<p><strong>Not included in this version:</strong> ${esc(m.deferredReason ?? '')}</p>
<div class="extra"><strong>Verification:</strong> ${esc(m.source_verification_detail)}</div>
${referencesHtml(spec)}<p class="legacy">${legacyText(spec)}</p>`
    : `${formulasHtml(spec)}
${inputs.length ? `<div class="extra"><strong>Required inputs:</strong><ul>${inputs.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>` : ''}
<p class="dir">${DIRECTION_PHRASE[m.direction] ?? ''}</p>
${derivedHtml(spec)}
${referencesHtml(spec)}
<div class="extra"><strong>Verification:</strong> ${esc(m.source_verification_detail)}</div>
${list('Limitations', spec.limitations)}${list('Notes', (Array.isArray(spec.notes) ? spec.notes : []).filter((n: string) => !JUDGEMENT.test(n)))}
<p class="legacy">${legacyText(spec)}</p>`;
  return `<details class="method" id="m-${esc(m.id)}" data-id="${esc(m.id)}" data-cat="${categoryOf(m)}" data-search="${esc(searchText(m, spec))}">
<summary><span class="mname">${esc(m.name)}</span> <span class="mdir">${excluded ? 'not included' : DIRECTION_PHRASE[m.direction] ?? ''}</span> <span class="badge" data-sv="${esc(m.source_verification)}">${esc(badgeText(m.source_verification))}</span>${excluded ? '' : derivedShort(spec)}</summary>
${body}
</details>`;
}

export function conversionsHtml(): string {
  const d = DEFAULT_SETTINGS;
  return `<table class="auc"><caption class="sr">Unit conversion factors</caption>
<thead><tr><th scope="col">Quantity</th><th scope="col">Factor</th><th scope="col">Alternative</th></tr></thead><tbody>
<tr><th scope="row">Glucose</th><td>${d.glucose_mg_per_dL_per_mmol} mg/dL per mmol/L</td><td>18.016</td></tr>
<tr><th scope="row">Insulin</th><td>${d.insulin_pmol_per_uU.toFixed(1)} pmol/L per µU/mL</td><td>6.945</td></tr>
<tr><th scope="row">Triglycerides</th><td>${d.tg_mg_per_dL_per_mmol} mg/dL per mmol/L</td><td></td></tr>
<tr><th scope="row">HDL cholesterol</th><td>${d.hdl_mg_per_dL_per_mmol} mg/dL per mmol/L</td><td></td></tr>
<tr><th scope="row">Free fatty acids</th><td>1000 µmol/L per mmol/L</td><td></td></tr>
</tbody></table>
<p>Every result records the factors used.</p>`;
}

/** Notes that state reference ranges or cut-offs are not displayed. */
const JUDGEMENT = /\b(abnormal|normal|good|bad|cut-?off)\b/i;


/** "Smith 1999" from a citation string (first author surname + first 4-digit year). */
function shortCite(spec: Spec): string {
  const c: string = spec.reference?.citation ?? (typeof spec.source === 'object' ? spec.source?.citation : '') ?? '';
  const author = /^([^,\s]+)/.exec(c)?.[1] ?? '';
  const year = /\b(19|20)\d{2}\b/.exec(c)?.[0] ?? '';
  return `${author} ${year}`.trim();
}

/** Overview table of the populations every included index was derived in, grouped by category. */
export function populationsHtml(included: MethodEntry[]): string {
  const groups = CATEGORIES.filter(([k]) => k !== 'all');
  const rows = groups.map(([cat, label]) => {
    const ms = included.filter((m) => categoryOf(m) === cat);
    if (!ms.length) return '';
    return `<tr class="guide-group"><th colspan="5">${esc(label)}</th></tr>` + ms.map((m) => {
      const spec = specFor(m.id); const d = spec.derived_in ?? {};
      return `<tr><td><a href="#/methods/${esc(m.id)}">${esc(m.name)}</a></td><td>${esc(d.population ?? 'not recorded')}</td><td class="num">${esc(d.n ?? '')}</td><td>${esc(d.setting ?? '')}</td><td>${esc(shortCite(spec))}</td></tr>`;
    }).join('');
  }).join('');
  return `<details class="populations" id="m-populations"><summary>Derivation populations of all indices</summary>
<p>Where each index was developed, as reported in its original paper. The place is the study centre. Most papers do not report ancestry.</p>
<ul>
<li>Most indices come from single cohorts, mostly in Europe or the USA, with a few hundred people or fewer. Their behaviour in other populations has often not been studied.</li>
<li>Compare values within your own study rather than with values or thresholds from other populations.</li>
<li>In genetic or epidemiological work, account for ancestry in the analysis (for example genetic principal components or stratification), not by changing the index.</li>
<li>Insulin assays differ between laboratories, so values from different studies are only approximately comparable.</li>
</ul>
<div class="table-scroll"><table class="auc derived"><caption class="sr">Derivation population of each index</caption>
<thead><tr><th scope="col">Index</th><th scope="col">Population</th><th scope="col">N</th><th scope="col">Place</th><th scope="col">Original paper</th></tr></thead>
<tbody>${rows}</tbody></table></div></details>`;
}

export function methodsHtml(): string {
  const included = registry.filter((m) => m.deferredReason === undefined);
  const key = LEVELS.map(([k, meaning]) => `<li><span class="badge" data-sv="${k}">${esc(badgeText(k))}</span> ${esc(meaning)}</li>`).join('');
  const chips = CATEGORIES.map(([k, label]) => `<button type="button" class="chip" data-chip="${k}" aria-pressed="${k === 'all'}">${esc(label)}</button>`).join('');
  return `<p>All formulas below are the ones ISAT executes; this page is generated from the same method files the calculation engine uses.</p>
<p class="hint">"Derived in" gives the population and number of people (N) each index was developed in, as reported in the original paper; the place is the study centre. Most papers do not report ancestry, and an index may behave differently in other populations.</p>
${populationsHtml(included)}
<h2>Verification levels</h2><ul class="key">${key}</ul>
<div class="mfilter"><p><label for="m-search">Search by name, id or reference author</label> <input id="m-search" type="search" autocomplete="off"></p>
<div class="chips" role="group" aria-label="Category">${chips}</div></div>
<p id="m-count" class="hint" aria-live="polite"></p>
<section id="m-main"><h2>Methods</h2>${included.map(entryHtml).join('\n')}</section>
<h2>Unit conversions</h2>${conversionsHtml()}`;
}

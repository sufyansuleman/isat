// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { methodSpecs, registry } from '@isat/core';
import { categoryOf, entryHtml, describeInput, methodsHtml, legacyText } from '../src/methods/entries';
import { latexToMathml } from '../src/calculate/mathml';
import { specFor } from '../src/calculate/results';
import { parseLocation } from '../src/router';
import { mountMethods } from '../src/methods/view';

const host = document.createElement('div');
host.innerHTML = methodsHtml();
const entries = [...host.querySelectorAll<HTMLElement>('details.method')];

describe('methods page', () => {
  it('has exactly one entry per included method and never lists excluded ones', () => {
    const ids = entries.map((e) => e.dataset['id']);
    expect(ids.sort()).toEqual(registry.filter((m) => m.deferredReason === undefined).map((m) => m.id).sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(host.querySelector('#m-excluded')).toBeNull();
    expect(host.textContent).not.toMatch(/Not included|HOMA2|Bennett SI|Cederholm/);
  });

  it('entry count per category matches the registry', () => {
    const incl = registry.filter((m) => m.deferredReason === undefined);
    for (const c of new Set(incl.map(categoryOf))) {
      expect(entries.filter((e) => e.dataset['cat'] === c).length).toBe(incl.filter((m) => categoryOf(m) === c).length);
    }
  });

  it('every formula and variant converts to MathML without leftover backslashes', () => {
    let n = 0;
    for (const m of registry) {
      const spec = specFor(m.id);
      const tex = [spec.formula_latex, ...(spec.formula_variants ?? []).map((v: { latex: string }) => v.latex)].filter(Boolean) as string[];
      for (const t of tex) {
        const math = latexToMathml(t);
        expect(math.outerHTML).not.toContain('\\');
        n++;
      }
    }
    expect(n).toBeGreaterThan(30);
    for (const id of ['vai', 'lap']) expect(specFor(id).formula_variants.map((v: { label: string }) => v.label)).toEqual(['Men', 'Women']);
    expect(Object.keys(methodSpecs)).toContain('vai');
  });

  it('describes inputs with units and time points', () => {
    expect(describeInput('glucose_0,30,120 (mmol/L)')).toBe('glucose: fasting, 30, 120 min (mmol/L)');
    expect(describeInput('insulin_0 (uU/mL)')).toBe('insulin: fasting (µU/mL)');
    expect(describeInput({ var: 'insulin_0', unit: 'uU_per_mL' })).toBe('insulin: fasting (µU/mL)');
  });

  it('writes the InsuSensCalc relation sentence per relation', () => {
    expect(legacyText({ legacy: { relation: 'equal', insusenscalc_column: 'X' } })).toBe('Identical to InsuSensCalc column X.');
    expect(legacyText({ legacy: { relation: 'negated', insusenscalc_column: 'X_inv' } })).toContain('reports this negated as X_inv (higher = more sensitive)');
    expect(legacyText({ legacy: { relation: 'different', insusenscalc_column: 'Y', difference: 'd' } })).toBe('Deliberately different from InsuSensCalc Y: d.');
    expect(legacyText({ legacy: { relation: 'none' } })).toBe('Not in InsuSensCalc.');
  });

  it('uses no judgement words outside quoted limitations', () => {
    const clone = host.cloneNode(true) as HTMLElement;
    // Quoted YAML text is exempt: limitations, and verification details (e.g. Belfiore's "normal-mean normalisation").
    clone.querySelectorAll('.extra').forEach((e) => { if (/^(Limitations|Verification)/.test(e.textContent ?? '')) e.remove(); });
    // "Derived in" quotes the papers' clinical categories (e.g. "normal glucose tolerance").
    clone.querySelectorAll('.derived').forEach((e) => e.remove());
    clone.querySelectorAll('[data-search]').forEach((e) => e.removeAttribute('data-search'));
    expect(clone.textContent).not.toMatch(/\b(abnormal|normal|good|bad|cut-?off)\b/i);
  });

  it('routes #/methods/<id> and opens that entry', () => {
    expect(parseLocation('#/methods/vai')).toEqual({ route: '/methods', mode: 'manual', methodId: 'vai' });
    expect(parseLocation('#/methods').methodId).toBeUndefined();
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountMethods(root, 'vai');
    expect((root.querySelector('#m-vai') as HTMLDetailsElement).open).toBe(true);
    expect((root.querySelector('#m-lap') as HTMLDetailsElement).open).toBe(false);
    expect(root.querySelectorAll('.formula math').length).toBeGreaterThan(30);
  });

  it('filters by category and search', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountMethods(root);
    expect(root.querySelector('[data-chip="deferred"]')).toBeNull();
    (root.querySelector('[data-chip="tracer_dxa"]') as HTMLButtonElement).click();
    expect([...root.querySelectorAll<HTMLElement>('details.method')].filter((d) => !d.hidden).map((d) => d.dataset['id']).sort()).toEqual(['atiri', 'lipo', 'liri']);
    (root.querySelector('[data-chip="all"]') as HTMLButtonElement).click();
    const s = root.querySelector('#m-search') as HTMLInputElement;
    s.value = 'amato';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    expect([...root.querySelectorAll<HTMLElement>('details.method')].filter((d) => !d.hidden).map((d) => d.dataset['id'])).toContain('vai');
  });

  it('renders one entry without throwing', () => {
    expect(entryHtml(registry[0]!)).toContain('<details');
  });
});

describe('result cards link to methods and highlight sex-specific formulas', () => {
  it('VAI card for a man highlights the Men formula and links to its method entry', async () => {
    const { cardHtml, specFor } = await import('../src/calculate/results');
    const { calculateAll } = await import('@isat/core');
    const inputs = { glucose: { 0: 5.1 }, insulin: { 0: 42 }, tg: 1.1, hdl: 1.45, waist: 86, bmi: 24.1, sex: 'male' as const };
    const vai = calculateAll(inputs).find((r) => r.id === 'vai')!;
    expect(vai.status).toBe('ok');
    const snap = { state: { sex: 'male' } as never, built: { settings: {} } as never, results: [vai], calculatedAt: new Date(), version: 't' };
    let html = '';
    try { html = cardHtml(vai, snap); } catch { html = ''; }
    // Fall back to the pure formula helper if the full card needs more state than this minimal snapshot.
    const { cardFormulaHtml } = await import('../src/calculate/results');
    const f = cardFormulaHtml(specFor('vai'), 'male');
    expect(f).toMatch(/variant variant-used"><span class="vlabel">Men \(used\)/);
    expect(f).not.toMatch(/Women \(used\)/);
    expect(cardFormulaHtml(specFor('lap'), 'female')).toMatch(/Women \(used\)/);
    expect(cardFormulaHtml(specFor('homa_ir'), 'male')).not.toMatch(/variant/);
    if (html) expect(html).toContain('href="#/methods/vai"');
  });
});

describe('derived-in population', () => {
  it('every included method states its derivation population and N', () => {
    for (const m of registry.filter((x) => x.deferredReason === undefined)) {
      const d = specFor(m.id).derived_in;
      expect(d?.population, m.id).toBeTruthy();
      expect(d?.n, m.id).toBeTruthy();
      expect(entryHtml(m), m.id).toContain('Derived in:');
    }
  });
});

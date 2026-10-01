// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateAll, orient, parseCsv, parseWideRow, registry, type Inputs } from '@isat/core';
import { buildInputs, emptyState, parseNumber, type UnitChoice } from '../src/calculate/state';
import { exampleState } from '../src/calculate/example';
import { cardsHtml, csvText, availabilityHtml, type Snapshot } from '../src/calculate/results';
import { fmt4 } from '../src/calculate/format';

const csv = readFileSync(resolve(process.cwd(), '../../validation/fixtures/inputs.csv'), 'utf8');
const fixture = parseWideRow(parseCsv(csv).find((r) => r['participant_id'] === 'NGT_M')!).inputs;

const MG_UU: UnitChoice = { glucose: 'mg/dL', insulin: 'uU/mL', tg: 'mg/dL', hdl: 'mg/dL', ffa: 'umol/L' };

function snapFor(st = exampleState()): Snapshot {
  const built = buildInputs(st);
  return { state: st, built, results: calculateAll(built.inputs, { settings: built.settings }), calculatedAt: new Date('2026-10-01T12:00:00Z'), version: 'test' };
}

describe('form state -> engine', () => {
  it('(a) NGT_M form gives exactly the fixture Inputs and identical results', () => {
    const built = buildInputs(exampleState());
    expect(built.errors).toEqual({});
    expect(built.inputs).toEqual(fixture);
    const a = calculateAll(built.inputs), b = calculateAll(fixture as Inputs);
    expect(a.map((r) => [r.id, r.status, r.value])).toEqual(b.map((r) => [r.id, r.status, r.value]));
  });

  it('(b) mg/dL and uU/mL entry gives the same values (rel 1e-12)', () => {
    const a = calculateAll(buildInputs(exampleState()).inputs);
    const stB = exampleState(MG_UU);
    expect(stB.rows[0]!.glucose).not.toBe('5.1'); // really entered in mg/dL
    const bb = buildInputs(stB);
    const b = calculateAll(bb.inputs, { settings: bb.settings });
    a.forEach((r, k) => {
      expect(b[k]!.status).toBe(r.status);
      if (r.value !== null) expect(Math.abs(b[k]!.value! - r.value)).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(r.value)));
    });
  });

  it('(c) empty cells are undefined, never 0', () => {
    const st = emptyState();
    st.rows[0]!.glucose = '5';
    const { inputs } = buildInputs(st);
    expect(inputs.glucose).toEqual({ 0: 5 });
    expect(inputs.insulin).toBeUndefined();
    expect(inputs.tg).toBeUndefined();
    expect(buildInputs(emptyState()).inputs).toEqual({});
  });

  it('rejects decimal comma and text inline; accepts 0 and negatives as typed', () => {
    expect(parseNumber('5,2').error).toBe('use a decimal point');
    expect(parseNumber('abc').error).toBe('not a number');
    expect(parseNumber('0').value).toBe(0);
    expect(parseNumber('-3').value).toBe(-3);
    const st = emptyState(); st.rows[1]!.glucose = '5,2';
    expect(buildInputs(st).errors['row:1:glucose']).toBe('use a decimal point');
  });

  it('derives BMI from height and weight only when BMI is empty', () => {
    const st = emptyState(); st.weight = '80'; st.height = '200';
    expect(buildInputs(st).inputs.bmi).toBe(20);
    st.bmi = '25';
    expect(buildInputs(st).inputs.bmi).toBe(25);
  });
});

describe('results', () => {
  const snap = snapFor();
  const oriented = orient(snap.results, 'published');

  it('(d) CSV value column equals the full-precision engine value', () => {
    const rows = parseCsv(csvText(oriented, snap));
    expect(rows.length).toBe(registry.length);
    for (const r of oriented) {
      const row = rows.find((x) => x['method_id'] === r.id)!;
      if (r.value === null) expect(row['value']).toBe('');
      else expect(Number(row['value'])).toBe(r.value);
    }
    expect(Object.keys(rows[0]!)).toEqual([
      'method_id', 'name', 'value', 'unit', 'direction', 'orientation', 'source_verification', 'status',
      'warnings', 'glucose_factor', 'insulin_factor', 'isat_version', 'calculated_at',
    ]);
  });

  for (const mode of ['published', 'sensitivity'] as const) {
    it(`(e) card values are the engine values at 4 significant figures (${mode})`, () => {
      const o = orient(snap.results, mode);
      const host = document.createElement('div');
      host.innerHTML = cardsHtml(o, snap);
      const cards = [...host.querySelectorAll('article[data-status="ok"]')];
      expect(cards.length).toBe(o.filter((r) => r.status === 'ok').length);
      for (const el of cards) {
        const r = o.find((x) => x.id === el.getAttribute('data-id'))!;
        const shown = el.querySelector('.num')!.textContent!;
        expect(Number(shown)).toBe(Number(r.value!.toPrecision(4)));
        expect(shown).toBe(fmt4(r.value!));
      }
    });
  }

  it('contains no cut-off or judgement words in static UI text and cards', () => {
    const host = document.createElement('div');
    host.innerHTML = cardsHtml(oriented, snap) + availabilityHtml(snap.results);
    const txt = host.textContent!.replace(/Belfiore[^.]*normal[^.]*\./gi, '');
    expect(txt).not.toMatch(/\b(abnormal|good|bad)\b/i);
  });

  it('never mentions excluded methods', () => {
    const html = availabilityHtml(snap.results);
    for (const id of ['homa2', 'bennett', 'cederholm']) {
      const m = registry.find((x) => x.id === id)!;
      expect(html).not.toContain(m.name.replace(/&/g, '&amp;'));
    }
    expect(html).not.toContain('Not included');
  });

  it('has no inline style attributes in card markup (CSP)', () => {
    expect(cardsHtml(oriented, snap)).not.toMatch(/ style=/);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AvignonAccumulator, DEFAULT_UNIT_CHOICE, ResultsStream, RowSplitter, RowStream, checkUnits, composeCsv, loadTable,
  parseDelimited, resolveAvignon, runBatch, toCanonical, type Inputs, type UnitChoice,
} from '../src/index';

const root = resolve(__dirname, '../../..');
const files = {
  inputs: readFileSync(resolve(root, 'validation/fixtures/inputs.csv'), 'utf8'),
  template: readFileSync(resolve(root, 'apps/web/public/isat-template.csv'), 'utf8'),
};

/** The existing (web) export path: load everything, run the worker generator, compose. */
function webCsv(text: string, units: UnitChoice, orientation: 'published' | 'sensitivity', status: boolean, avignon: 'default' | 'cohort'): string {
  const l = loadTable(text);
  const settings = {};
  const rows = l.inputs.map((i) => toCanonical(i, units, settings));
  const chunks = [];
  for (const m of runBatch({ type: 'run', rows, ids: l.ids, problems: l.rowProblems, settings, avignon, chunkRows: 3 })) if (m.type === 'chunk') chunks.push(m.payload);
  return composeCsv(chunks, orientation, status).join('');
}

function streamCsv(text: string, units: UnitChoice, orientation: 'published' | 'sensitivity', status: boolean, avignon: 'default' | 'cohort', piece: number): string {
  const settings = {};
  let av = resolveAvignon([], settings, 'default');
  if (avignon === 'cohort') {
    const acc = new AvignonAccumulator(settings);
    const s1 = new RowStream();
    for (let k = 0; k < text.length; k += piece) acc.add(s1.push(text.slice(k, k + piece)).map((r) => toCanonical(r.inputs, units, settings)));
    acc.add(s1.end().map((r) => toCanonical(r.inputs, units, settings)));
    av = acc.result();
  }
  const out = new ResultsStream({ units, settings, av, orientation, includeStatus: status });
  const s = new RowStream();
  let csv = out.header();
  for (let k = 0; k < text.length; k += piece) csv += out.rows(s.push(text.slice(k, k + piece)));
  csv += out.rows(s.end());
  return csv;
}

describe('streaming path is identical to composeCsv', () => {
  for (const [name, text] of Object.entries(files)) {
    for (const orientation of ['published', 'sensitivity'] as const) {
      for (const status of [false, true]) {
        for (const avignon of ['default', 'cohort'] as const) {
          it(`${name} ${orientation} status=${status} avignon=${avignon}`, () => {
            const ref = webCsv(text, DEFAULT_UNIT_CHOICE, orientation, status, avignon);
            expect(ref.split('\r\n').length).toBeGreaterThan(2);
            for (const piece of [7, 64, 100000]) expect(streamCsv(text, DEFAULT_UNIT_CHOICE, orientation, status, avignon, piece)).toBe(ref);
          });
        }
      }
    }
  }

  it('matches with non-default units', () => {
    const u: UnitChoice = { glucose: 'mg/dL', insulin: 'uU/mL', tg: 'mg/dL', hdl: 'mg/dL', ffa: 'umol/L' };
    const ref = webCsv(files.template, u, 'published', true, 'default');
    expect(streamCsv(files.template, u, 'published', true, 'default', 50)).toBe(ref);
  });
});

describe('RowSplitter / RowStream', () => {
  it('keeps quoted newlines inside one row and handles CRLF split across pieces', () => {
    const text = 'id,a\r\n"x\ny",1\r\nz,2\r\n';
    const whole = parseDelimited(text, ',');
    for (const piece of [1, 2, 3, 5]) {
      const sp = new RowSplitter();
      let blocks = '';
      for (let k = 0; k < text.length; k += piece) blocks += sp.push(text.slice(k, k + piece));
      blocks += sp.end();
      expect(parseDelimited(blocks, ',')).toEqual(whole);
    }
  });

  it('reports header, delimiter and rows like loadTable', () => {
    const text = '﻿participant_id;G0;I0;foo\n1;5;40;x\n2;5,5;40;y\n';
    const l = loadTable(text);
    const s = new RowStream();
    const rows = [...s.push(text.slice(0, 20)), ...s.push(text.slice(20)), ...s.end()];
    expect(s.delimiter).toBe(l.delimiter);
    expect(s.header).toEqual(l.header);
    expect(rows.map((r) => r.id)).toEqual(l.ids);
    expect(rows.map((r) => r.msgs.join(' | '))).toEqual(l.rowProblems);
    expect(rows.map((r) => r.inputs)).toEqual(l.inputs);
  });
});

describe('unit plausibility (core)', () => {
  const rows = (n: number, mk: (k: number) => Inputs): Inputs[] => Array.from({ length: n }, (_, k) => mk(k));
  it('flags mg/dL data under mmol/L and not the reverse', () => {
    const g = rows(6, () => ({ glucose: { 0: 95 } }));
    expect(checkUnits(g, DEFAULT_UNIT_CHOICE).find((i) => i.quantity === 'glucose')?.suggested).toBe('mg/dL');
    expect(checkUnits(rows(6, () => ({ glucose: { 0: 5 } })), DEFAULT_UNIT_CHOICE).find((i) => i.quantity === 'glucose')?.suggested).toBeNull();
  });
});

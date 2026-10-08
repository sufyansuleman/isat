import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateAll, calculateBatch, orient, parseCsv, parseWideRow, registry, type Inputs } from '@isat/core';
import {
  checkFileSize, checkRowCount, countDataRows, hasAllowedExtension, LIMIT_MESSAGE, MAX_DATA_ROWS, MAX_FILE_BYTES,
} from '@isat/core';
import { classifyColumn, detectDelimiter, loadTable, parseDelimited, toCanonical } from '@isat/core';
import {
  composeCsv, INCLUDED, mergeCounts, emptyCounts, NEGATED, runBatch, settingsFile, type ChunkPayload, type WorkerMessage,
} from '@isat/core';
import { DEFAULT_UNITS } from '../src/calculate/state';

const fixtureText = readFileSync(resolve(process.cwd(), '../../validation/fixtures/inputs.csv'), 'utf8');
const fixtureRows: Inputs[] = parseCsv(fixtureText).map((r) => parseWideRow(r).inputs);

function drive(rows: Inputs[], ids: string[], avignon: 'default' | 'cohort' = 'default', chunkRows = 2) {
  const msgs: WorkerMessage[] = [...runBatch({ type: 'run', rows, ids, settings: {}, avignon, chunkRows })];
  const chunks = msgs.flatMap((m) => (m.type === 'chunk' ? [m.payload] : []));
  return { msgs, chunks };
}
const table = (chunks: ChunkPayload[], mode: 'published' | 'sensitivity' = 'published', status = false) =>
  parseDelimited(composeCsv(chunks, mode, status).join(''), ',');

describe('limits', () => {
  it('rejects files just over 25 MB by size (File object, before reading)', () => {
    expect(checkFileSize(MAX_FILE_BYTES)).toEqual({ ok: true });
    const r = checkFileSize(MAX_FILE_BYTES + 1);
    expect(r).toEqual({ ok: false, message: LIMIT_MESSAGE });
    expect(LIMIT_MESSAGE).toBe('File exceeds the online limit (100,000 rows / 25 MB). For more than 100,000 individuals, use the ISAT command-line tool for Linux: https://github.com/sufyansuleman/isat/releases/latest');
  });
  it('accepts 100,000 data rows and rejects 100,001', () => {
    const mk = (n: number) => 'id,G0\n' + '1,5\n'.repeat(n);
    expect(countDataRows(mk(MAX_DATA_ROWS))).toBe(100000);
    expect(checkRowCount(mk(MAX_DATA_ROWS))).toEqual({ ok: true });
    expect(checkRowCount(mk(MAX_DATA_ROWS + 1))).toEqual({ ok: false, message: LIMIT_MESSAGE });
    expect(checkRowCount('id,G0\n1,5')).toEqual({ ok: true }); // no trailing newline
  });
  it('allows only .csv and .tsv', () => {
    expect(hasAllowedExtension('a.CSV')).toBe(true);
    expect(hasAllowedExtension('a.tsv')).toBe(true);
    expect(hasAllowedExtension('a.xlsx')).toBe(false);
  });
});

describe('parsing', () => {
  it('detects comma, semicolon and tab delimiters', () => {
    expect(detectDelimiter('id,G0,I0\n1,5,40')).toBe('comma');
    expect(detectDelimiter('id;G0;I0\n1;5;40')).toBe('semicolon');
    expect(detectDelimiter('id\tG0\tI0\n1\t5\t40')).toBe('tab');
    expect(detectDelimiter('"a,b";c;d\n')).toBe('semicolon');
  });
  it('keeps IDs exactly as text', () => {
    const l = loadTable('participant_id,G0\n007,5\n1e3,6\n 12 ,7\n');
    expect(l.ids).toEqual(['007', '1e3', ' 12 ']);
    expect(l.generatedIds).toBe(false);
  });
  it('generates row_N IDs when there is no ID column and warns on duplicates', () => {
    expect(loadTable('G0\n5\n6\n').ids).toEqual(['row_1', 'row_2']);
    const l = loadTable('id,G0\nA,5\nA,6\n');
    expect(l.duplicateIds).toEqual(['A']);
  });
  it('gives a per-cell problem for a decimal comma and treats the cell as missing', () => {
    const l = loadTable('id;G0;I0\nA;5,2;40\nB;5.2;41\n');
    expect(l.rowsWithProblems).toBe(1);
    expect(l.problems[0]!.messages.join(' ')).toContain('use a decimal point');
    expect(l.inputs[0]!.glucose).toBeUndefined();
    expect(l.inputs[1]!.glucose).toEqual({ 0: 5.2 });
  });
  it('flags unknown sex codes and recognises 1/2, m/f, male/female', () => {
    const l = loadTable('id,sex\na,1\nb,f\nc,male\nd,x\n');
    expect(l.inputs.map((i) => i.sex)).toEqual(['male', 'female', 'male', undefined]);
    expect(l.rowsWithProblems).toBe(1);
  });
  it('maps columns case-insensitively and marks unknown ones ignored', () => {
    expect(classifyColumn('HDL_c').variable).toBe('HDL cholesterol');
    expect(classifyColumn('g120').variable).toBe('glucose at 120 min');
    expect(classifyColumn('FFA').variable).toBe('fasting FFA');
    expect(classifyColumn('Id').kind).toBe('id');
    expect(classifyColumn('notes').kind).toBe('ignored');
  });
  it('handles quotes, CRLF and a BOM', () => {
    expect(parseDelimited('﻿a,b\r\n"x,1","y""z"\r\n', ',')).toEqual([['a', 'b'], ['x,1', 'y"z']]);
  });
  it('converts file units to canonical through core', () => {
    const c = toCanonical({ glucose: { 0: 90 }, insulin: { 0: 7 } }, { ...DEFAULT_UNITS, glucose: 'mg/dL', insulin: 'uU/mL' }, { glucose_mg_per_dL_per_mmol: 18, insulin_pmol_per_uU: 6 });
    expect(c.glucose![0]).toBeCloseTo(5, 12);
    expect(c.insulin![0]).toBeCloseTo(42, 12);
  });
});

describe('batch processing', () => {
  const loaded = loadTable(fixtureText);
  it('reads the fixture into the same Inputs as core parseWideRow', () => {
    expect(loaded.inputs).toEqual(fixtureRows);
  });

  it('matches calculateAll row by row (default Avignon weight)', () => {
    const { chunks } = drive(loaded.inputs, loaded.ids, 'default');
    const t = table(chunks);
    expect(t.length).toBe(fixtureRows.length + 1);
    fixtureRows.forEach((row, r) => {
      const res = calculateAll(row);
      INCLUDED.forEach((m, c) => {
        const x = res.find((q) => q.id === m.id)!;
        expect(t[r + 1]![c + 2]).toBe(x.status === 'ok' ? String(x.value) : '');
      });
      expect(t[r + 1]![0]).toBe(loaded.ids[r]);
    });
  });

  it('cohort option equals calculateBatch avignon_weight sample', () => {
    const { chunks, msgs } = drive(loaded.inputs, loaded.ids, 'cohort');
    const w = msgs.find((m) => m.type === 'weight');
    expect(w && w.type === 'weight' && w.use.source).toBe('sample');
    const t = table(chunks);
    const ref = calculateBatch(fixtureRows, { avignon_weight: 'sample' });
    ref.forEach((res, r) => INCLUDED.forEach((m, c) => {
      const x = res.find((q) => q.id === m.id)!;
      expect(t[r + 1]![c + 2]).toBe(x.status === 'ok' ? String(x.value) : '');
    }));
  });

  it('_inv columns are named and signed exactly as orient() does', () => {
    const { chunks } = drive(loaded.inputs, loaded.ids, 'default');
    const t = table(chunks, 'sensitivity');
    const header = t[0]!;
    fixtureRows.forEach((row, r) => {
      const res = orient(calculateAll(row), 'sensitivity');
      for (const x of res.filter((q) => INCLUDED.some((m) => m.id === q.id.replace(/_inv$/, '')))) {
        const c = header.indexOf(x.id);
        expect(c).toBeGreaterThan(0);
        expect(t[r + 1]![c]).toBe(x.status === 'ok' ? String(x.value) : '');
      }
    });
    expect(header.filter((h) => h.endsWith('_inv')).length).toBe(NEGATED.size);
    expect(header.some((h) => h.endsWith('_inv_inv'))).toBe(false);
  });

  it('adds status columns only when asked', () => {
    const { chunks } = drive(loaded.inputs, loaded.ids, 'default');
    expect(table(chunks)[0]!.length).toBe(INCLUDED.length + 2);
    const t = table(chunks, 'published', true);
    expect(t[0]!.length).toBe(2 + 2 * INCLUDED.length);
    expect(t[0]![2 + INCLUDED.length]).toBe(`${INCLUDED[0]!.id}_status`);
  });

  it('writes empty cells, never 0, for what cannot be calculated', () => {
    const rows: Inputs[] = [{ glucose: { 0: 5 }, insulin: { 0: 40 } }, {}];
    const { chunks } = drive(rows, ['a', 'b']);
    const t = table(chunks);
    const matsuda = t[0]!.indexOf('matsuda_3pt');
    expect(t[1]![matsuda]).toBe('');
    expect(t[2]!.slice(2).every((c) => c === '')).toBe(true);
    expect(t.slice(1).flat().includes('0')).toBe(false);
  });

  it('streams a sensible message protocol and counters', () => {
    const { msgs } = drive(loaded.inputs, loaded.ids, 'default', 3);
    expect(msgs[0]!.type).toBe('weight');
    expect(msgs.at(-1)!.type).toBe('done');
    const chunkMsgs = msgs.filter((m): m is Extract<WorkerMessage, { type: 'chunk' }> => m.type === 'chunk');
    expect(chunkMsgs.map((m) => m.index)).toEqual(Array.from({ length: Math.ceil(fixtureRows.length / 3) }, (_, k) => k));
    expect(chunkMsgs.at(-1)!.done).toBe(fixtureRows.length);
    const total = emptyCounts();
    chunkMsgs.forEach((m) => mergeCounts(total, m.counts));
    for (const m of INCLUDED) {
      const c = total[m.id]!;
      expect(c.ok + c.unavailable + c.error).toBe(fixtureRows.length);
    }
  });

  it('builds a settings file with the required fields', () => {
    const s = settingsFile({
      version: '0.0.1', timestamp: 't', fileName: 'x.csv', delimiter: 'comma', units: { glucose: 'mmol/L' },
      settings: {}, avignon: { w: 0.137, source: 'avignon_1999', warnings: [] }, orientation: 'sensitivity',
      includeStatus: false, rows: { total: 4, withProblems: 0, calculated: 4 },
    }) as Record<string, any>;
    for (const k of ['isat_version', 'timestamp', 'input_file', 'units', 'conversion_factors', 'avignon_weight', 'orientation', 'belfiore_reference_set', 'row_counts', 'methods', 'delimiter']) expect(s).toHaveProperty(k);
    expect(s['methods'].length).toBe(registry.filter((m) => m.deferredReason === undefined).length);
    expect(s['methods'].find((m: any) => m.id === 'homa_ir').csv_column).toBe('homa_ir_inv');
  });
});

describe('input_problems column', () => {
  it('reports problem cells per row and keeps IDs exactly', () => {
    const l = loadTable('participant_id;sex;G30;I30;weight\n007;m;5.4;55;80\n1e3;m;5,4;55;80\n');
    const chunks = [...runBatch({ type: 'run', rows: l.inputs, ids: l.ids, problems: l.rowProblems, settings: {}, avignon: 'default', chunkRows: 1 })].flatMap((m) => (m.type === 'chunk' ? [m.payload] : []));
    const t = parseDelimited(composeCsv(chunks, 'published', false).join(''), ',');
    expect(t[0]!.slice(0, 2)).toEqual(['participant_id', 'input_problems']);
    expect(t[1]!.slice(0, 2)).toEqual(['007', '']);
    expect(t[2]![0]).toBe('1e3');
    expect(t[2]![1]).toContain('use a decimal point');
    expect(t[2]![1]).toContain('G30');
    const s = settingsFile({
      version: 'v', timestamp: 't', fileName: 'semi.csv', delimiter: 'semicolon', units: {}, settings: {},
      avignon: { w: 0.137, source: 'avignon_1999', warnings: [] }, orientation: 'published', includeStatus: false,
      rows: { total: 2, withProblems: l.rowsWithProblems, calculated: 2 },
    }) as Record<string, any>;
    expect(s['row_counts'].rows_with_input_problems).toBe(1);
  });
});

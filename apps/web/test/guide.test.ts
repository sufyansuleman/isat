import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateAll, parseCsv, parseWideRow, type Inputs } from '@isat/core';
import { classifyColumn, columnConflicts, loadTable, SCALARS } from '../src/upload/parse';
import { INCLUDED, SEP, runBatch } from '../src/upload/batch';
import { MAX_DATA_ROWS, MAX_FILE_BYTES } from '../src/upload/limits';
import { specFor } from '../src/calculate/results';

const guide = readFileSync(resolve(process.cwd(), 'src/calculate/guide.html'), 'utf8');
const template = readFileSync(resolve(process.cwd(), 'public/isat-template.csv'), 'utf8');

describe('usage guide', () => {
  it('(a) mentions every column name and alias the upload parser recognises', () => {
    const names = ['participant_id', 'id', ...Object.keys(SCALARS).filter((k) => k !== 'hdl'), 'G0', 'G30', 'G60', 'G90', 'G120', 'I0', 'I30', 'I60', 'I90', 'I120'];
    for (const n of names) {
      expect(classifyColumn(n).kind).not.toBe('ignored');
      expect(guide.toLowerCase()).toContain(n.toLowerCase());
    }
    for (const a of ['fasting_glucose', 'fasting_insulin', 'glucose_', 'insulin_']) expect(guide).toContain(a);
    expect(guide).toContain('HDL');
  });

  it('(c) the stated limits match the constants', () => {
    const m = /Limit: ([\d,]+) rows or (\d+) MB/.exec(guide)!;
    expect(Number(m[1]!.replace(/,/g, ''))).toBe(MAX_DATA_ROWS);
    expect(Number(m[2]) * 1024 * 1024).toBe(MAX_FILE_BYTES);
  });
});

describe('example file (alias headers)', () => {
  const l = loadTable(template);
  const chunk = [...runBatch({ type: 'run', rows: l.inputs, ids: l.ids, settings: {}, avignon: 'default' })]
    .flatMap((m) => (m.type === 'chunk' ? [m] : []))[0]!;
  const col = (id: string) => INCLUDED.findIndex((m) => m.id === id);
  const status = (id: string, who: string) => chunk.payload.status[col(id)]!.split(SEP)[l.ids.indexOf(who)];
  // avignon_si0 is filed under category ogtt in the YAML but uses fasting values only.
  const ogtt = INCLUDED.filter((m) => specFor(m.id).category === 'ogtt' && m.id !== 'avignon_si0').map((m) => m.id);

  it('has 10 rows, no problems, IDs preserved exactly', () => {
    expect(l.total).toBe(10);
    expect(l.rowsWithProblems).toBe(0);
    expect(l.fileErrors).toEqual([]);
    expect(l.ids).toEqual(Array.from({ length: 10 }, (_, k) => `SAMPLE_${String(k + 1).padStart(3, '0')}`));
  });

  it('SAMPLE_006 (3-point): matsuda_3pt ok, matsuda_5pt unavailable, Belfiore ISI uses the 0-2h variant', () => {
    expect(status('matsuda_3pt', 'SAMPLE_006')).toBe('ok');
    expect(status('matsuda_5pt', 'SAMPLE_006')).toBe('unavailable');
    expect(status('belfiore_isi_gly', 'SAMPLE_006')).toBe('ok');
    const r = calculateAll(l.inputs[l.ids.indexOf('SAMPLE_006')]!).find((x) => x.id === 'belfiore_isi_gly')!;
    expect(r.details?.['variant']).toBe('0_2h');
  });

  it('SAMPLE_010 (no 90 min): matsuda_5pt unavailable, matsuda_3pt ok', () => {
    expect(status('matsuda_5pt', 'SAMPLE_010')).toBe('unavailable');
    expect(status('matsuda_3pt', 'SAMPLE_010')).toBe('ok');
  });

  it('SAMPLE_008 (fasting + lipids): fasting/lipid methods ok, OGTT methods unavailable', () => {
    for (const id of ['homa_ir', 'quicki', 'tyg', 'mcauley', 'tg_hdl', 'vai', 'lap']) expect(status(id, 'SAMPLE_008'), id).toBe('ok');
    expect(ogtt.length).toBeGreaterThan(5);
    for (const id of ogtt) expect(status(id, 'SAMPLE_008'), id).not.toBe('ok');
  });

  it('SAMPLE_009 (fasting, no lipids): homa_ir, quicki ok; tyg, mcauley unavailable', () => {
    for (const id of ['homa_ir', 'quicki']) expect(status(id, 'SAMPLE_009'), id).toBe('ok');
    for (const id of ['tyg', 'mcauley']) expect(status(id, 'SAMPLE_009'), id).toBe('unavailable');
  });

  it('every ok value equals calculateAll on Inputs built directly with canonical headers', () => {
    const canon = (h: string) => {
      const x = h.toLowerCase();
      if (x === 'fasting_glucose') return 'G0';
      if (x === 'fasting_insulin') return 'I0';
      const m = /^(glucose|insulin)_(\d+)$/.exec(x);
      return m ? `${m[1] === 'glucose' ? 'G' : 'I'}${m[2]}` : h;
    };
    const direct: Inputs[] = parseCsv(template).map((r) => parseWideRow(Object.fromEntries(Object.entries(r).map(([k, v]) => [canon(k), v]))).inputs);
    l.ids.forEach((id, row) => {
      const res = calculateAll(direct[row]!);
      for (const m of INCLUDED) {
        const x = res.find((q) => q.id === m.id)!;
        const cell = chunk.payload.vals[col(m.id)]!.split(SEP)[row];
        expect(cell, `${id} ${m.id}`).toBe(x.status === 'ok' ? String(x.value) : '');
      }
    });
  });
});

describe('column aliases', () => {
  it('maps aliases to the canonical series with a fasting label', () => {
    expect(classifyColumn('Fasting_Glucose')).toMatchObject({ canonical: 'G0', variable: 'fasting glucose' });
    expect(classifyColumn('fasting_insulin')).toMatchObject({ canonical: 'I0', variable: 'fasting insulin' });
    expect(classifyColumn('glucose_30')).toMatchObject({ canonical: 'G30', variable: 'glucose at 30 min' });
    expect(classifyColumn('INSULIN_120')).toMatchObject({ canonical: 'I120' });
    const l = loadTable('id,fasting_glucose,fasting_insulin,glucose_30,insulin_30\nA,5,40,7,200\n');
    expect(l.inputs[0]!.glucose).toEqual({ 0: 5, 30: 7 });
    expect(l.inputs[0]!.insulin).toEqual({ 0: 40, 30: 200 });
  });

  it('rejects a file that has both an alias and the canonical column', () => {
    const l = loadTable('id,G0,fasting_glucose\nA,5,5\n');
    expect(l.fileErrors).toEqual(['Columns G0 and fasting_glucose both give fasting glucose; keep only one']);
    expect(columnConflicts(loadTable('id,G30,glucose_30\nA,1,2\n').columns)).toHaveLength(1);
    expect(loadTable('id,G0,I0\nA,5,5\n').fileErrors).toEqual([]);
  });
});

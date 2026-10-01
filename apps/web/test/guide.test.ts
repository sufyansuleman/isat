import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyColumn, loadTable, SCALARS } from '../src/upload/parse';
import { INCLUDED, runBatch } from '../src/upload/batch';
import { MAX_DATA_ROWS, MAX_FILE_BYTES } from '../src/upload/limits';

const guide = readFileSync(resolve(process.cwd(), 'src/calculate/guide.html'), 'utf8');
const template = readFileSync(resolve(process.cwd(), 'public/isat-template.csv'), 'utf8');

describe('usage guide', () => {
  it('(a) mentions every column name the upload parser recognises', () => {
    const names = ['participant_id', 'id', ...Object.keys(SCALARS).filter((k) => k !== 'hdl'), 'G0', 'G30', 'G60', 'G90', 'G120', 'I0', 'I30', 'I60', 'I90', 'I120'];
    for (const n of names) {
      expect(classifyColumn(n).kind).not.toBe('ignored');
      expect(guide.toLowerCase()).toContain(n.toLowerCase());
    }
    expect(guide).toContain('HDL');
  });

  it('(b) the template parses cleanly; P002 lacks only the 60/90-minute methods', () => {
    const l = loadTable(template);
    expect(l.total).toBe(2);
    expect(l.rowsWithProblems).toBe(0);
    expect(l.ids).toEqual(['P001', 'P002']);
    const chunk = [...runBatch({ type: 'run', rows: l.inputs, ids: l.ids, settings: {}, avignon: 'default' })]
      .flatMap((m) => (m.type === 'chunk' ? [m] : []))[0]!;
    const col = (id: string) => INCLUDED.findIndex((m) => m.id === id);
    const status = (id: string, row: number) => chunk.payload.status[col(id)]!.split('\u001e')[row];
    expect(status('matsuda_5pt', 0)).toBe('ok');
    expect(status('matsuda_5pt', 1)).toBe('unavailable');
    for (const id of ['matsuda_3pt', 'matsuda_auc_3pt', 'isi_120', 'ig_ratio_120', 'gutt', 'stumvoll_mod', 'stumvoll_dem', 'bigtt_si', 'avignon_si120', 'hiri', 'ifc']) {
      expect(status(id, 1), id).toBe('ok');
    }
  });

  it('(c) the stated limits match the constants', () => {
    const m = /Limit: ([\d,]+) rows or (\d+) MB/.exec(guide)!;
    expect(Number(m[1]!.replace(/,/g, ''))).toBe(MAX_DATA_ROWS);
    expect(Number(m[2]) * 1024 * 1024).toBe(MAX_FILE_BYTES);
  });
});

import { describe, expect, it } from 'vitest';
import {
  GROUP_IDS, INCLUDED, SELECTION_GROUPS, SelectionError, describeSelection, isFullSelection, resolveSelection, selectedMethods, settingsFile,
} from '../src';

const all = INCLUDED.map((m) => m.id);

describe('resolveSelection', () => {
  it('nothing given = every included index, in registry order', () => {
    expect(resolveSelection()).toEqual(all);
    expect(resolveSelection({})).toEqual(all);
    expect(isFullSelection(resolveSelection())).toBe(true);
  });
  it('the six groups cover every included method', () => {
    expect(GROUP_IDS).toEqual(['fasting', 'ogtt', 'lipid', 'tracer_dxa', 'secretion', 'glucagon']);
    expect(SELECTION_GROUPS.length).toBe(6);
    expect(INCLUDED.every((m) => GROUP_IDS.includes(m.category))).toBe(true);
    expect(resolveSelection({ groups: GROUP_IDS })).toEqual(all);
    expect(resolveSelection({ groups: ['all'] })).toEqual(all);
  });
  it('groups and ids are added; the result is in registry order and without duplicates', () => {
    const r = resolveSelection({ groups: ['glucagon', 'fasting'], ids: ['matsuda_3pt', 'homa_ir'] });
    expect(r).toEqual(all.filter((i) => r.includes(i)));
    expect(new Set(r).size).toBe(r.length);
    expect(r).toContain('matsuda_3pt');
    expect(r.filter((i) => INCLUDED.find((m) => m.id === i)!.category === 'glucagon').length).toBe(INCLUDED.filter((m) => m.category === 'glucagon').length);
    expect(resolveSelection({ ids: ['di_bigtt'] })).toEqual(['di_bigtt']);
  });
  it('unknown names are errors that list the allowed names', () => {
    expect(() => resolveSelection({ groups: ['nope'] })).toThrow(SelectionError);
    expect(() => resolveSelection({ groups: ['nope'] })).toThrow(/use: fasting, ogtt, lipid, tracer_dxa, secretion, glucagon, all/);
    expect(() => resolveSelection({ ids: ['homa_ir', 'nope'] })).toThrow(/unknown index id "nope" \(use: .*homa_ir/);
  });
  it('an empty result is an error', () => {
    expect(() => resolveSelection({ groups: [] })).toThrow(/no indices selected/);
    expect(() => resolveSelection({ groups: [], ids: [] })).toThrow(SelectionError);
  });
});

describe('describeSelection and the settings record', () => {
  it('describes fully selected groups plus the other ids, and round-trips', () => {
    const ids = resolveSelection({ groups: ['secretion'], ids: ['homa_ir'] });
    const d = describeSelection(ids);
    expect(d).toEqual({ groups: ['secretion'], ids: ['homa_ir'] });
    expect(resolveSelection(d)).toEqual(ids);
    expect(describeSelection(all).groups).toEqual(GROUP_IDS);
  });
  const base = {
    version: 'v', timestamp: 'T', fileName: 'f.csv', delimiter: 'comma', units: {}, settings: {},
    avignon: { w: 0.137, source: 'avignon_1999' as const, warnings: [] }, orientation: 'published' as const, includeStatus: false,
    rows: { total: 1, withProblems: 0, calculated: 1 },
  };
  it('records the selection only when it is not all; default settings are unchanged', () => {
    const def = settingsFile(base);
    expect('selection' in def).toBe(false);
    expect(settingsFile({ ...base, selection: all })).toEqual(def);
    expect(JSON.stringify(settingsFile({ ...base, selection: all }))).toBe(JSON.stringify(def));
    const part = settingsFile({ ...base, selection: resolveSelection({ groups: ['glucagon'] }) });
    const sel = part['selection'] as { groups: string[]; ids: string[]; methods: string[] };
    expect(sel.groups).toEqual(['glucagon']);
    expect(sel.ids).toEqual([]);
    expect(sel.methods).toEqual(selectedMethods(sel.methods).map((m) => m.id));
    expect((part['methods'] as Array<{ id: string }>).map((m) => m.id)).toEqual(sel.methods);
  });
});

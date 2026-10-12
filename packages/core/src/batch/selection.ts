// Which indices are shown and exported. Calculation stays complete (some indices depend on others);
// a selection only filters the output. Pure; shared by the web app and the command-line tool.
import { registry, type MethodEntry } from '../registry';

const INCL: MethodEntry[] = registry.filter((m) => m.deferredReason === undefined);

/** Index groups (registry categories) in display order, with their labels. */
export const SELECTION_GROUPS: Array<[string, string]> = [
  ['fasting', 'Fasting'], ['ogtt', 'OGTT'], ['lipid', 'Lipid & body measures'], ['tracer_dxa', 'Tracer & DXA'],
  ['secretion', 'Insulin secretion (beta cell)'], ['glucagon', 'Glucagon (alpha cell)'],
];
export const GROUP_IDS: string[] = SELECTION_GROUPS.map(([k]) => k);

export class SelectionError extends Error {}

export interface SelectionInput { groups?: string[]; ids?: string[] }

const clean = (l: string[] | undefined): string[] | undefined => l?.map((s) => s.trim()).filter((s) => s !== '');

/**
 * Method ids (registry order) chosen by groups plus individual ids. Nothing given = every included index.
 * 'all' as a group name means every group. Unknown names and an empty result are errors that list the allowed names.
 */
export function resolveSelection(sel: SelectionInput = {}): string[] {
  const groups = clean(sel.groups), ids = clean(sel.ids);
  if (groups === undefined && ids === undefined) return INCL.map((m) => m.id);
  const bad = (groups ?? []).filter((g) => g !== 'all' && !GROUP_IDS.includes(g));
  if (bad.length) throw new SelectionError(`unknown index group${bad.length > 1 ? 's' : ''} ${bad.map((b) => `"${b}"`).join(', ')} (use: ${GROUP_IDS.join(', ')}, all)`);
  const known = new Set(INCL.map((m) => m.id));
  const badIds = (ids ?? []).filter((i) => !known.has(i));
  if (badIds.length) throw new SelectionError(`unknown index id${badIds.length > 1 ? 's' : ''} ${badIds.map((b) => `"${b}"`).join(', ')} (use: ${[...known].join(', ')})`);
  const allGroups = (groups ?? []).includes('all');
  const g = new Set(groups ?? []);
  const i = new Set(ids ?? []);
  const out = INCL.filter((m) => allGroups || g.has(m.category) || i.has(m.id)).map((m) => m.id);
  if (!out.length) throw new SelectionError('no indices selected (choose at least one group or index)');
  return out;
}

/** The method entries for resolved ids, registry order. */
export function selectedMethods(ids: string[]): MethodEntry[] {
  const s = new Set(ids);
  return INCL.filter((m) => s.has(m.id));
}

/** True when every included index is selected (the default; outputs then carry no selection record). */
export const isFullSelection = (ids: string[]): boolean => new Set(ids).size === INCL.length && INCL.every((m) => ids.includes(m.id));

/** Canonical description of a resolved selection: the groups that are fully selected, plus the ids in the other groups. */
export function describeSelection(ids: string[]): { groups: string[]; ids: string[] } {
  const s = new Set(ids);
  const groups = GROUP_IDS.filter((g) => {
    const ms = INCL.filter((m) => m.category === g);
    return ms.length > 0 && ms.every((m) => s.has(m.id));
  });
  return { groups, ids: INCL.filter((m) => s.has(m.id) && !groups.includes(m.category)).map((m) => m.id) };
}

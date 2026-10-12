// "Indices to include" control shared by the Calculate and Upload tabs. The selection only filters what is shown and
// exported; every index is still calculated. State is a set of method ids; chips and checkboxes are views of it.
import { INCLUDED, SELECTION_GROUPS, describeSelection, resolveSelection } from '@isat/core';
import { esc } from './calculate/format';

const KEY = 'isat-index-selection';

export interface SelectionStorage { getItem(k: string): string | null; setItem(k: string, v: string): void }

function defaultStorage(): SelectionStorage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
}

/** Saved selection as a set of ids; all indices when nothing valid is saved or storage is unavailable. */
export function loadSelection(storage: SelectionStorage | undefined = defaultStorage()): Set<string> {
  try {
    const raw = storage?.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw) as { groups?: unknown; ids?: unknown };
      const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
      return new Set(resolveSelection({ groups: strs(j.groups), ids: strs(j.ids) }));
    }
  } catch { /* fall back to all */ }
  return new Set(INCLUDED.map((m) => m.id));
}

export function saveSelection(ids: ReadonlySet<string>, storage: SelectionStorage | undefined = defaultStorage()): void {
  try { storage?.setItem(KEY, JSON.stringify(describeSelection(INCLUDED.filter((m) => ids.has(m.id)).map((m) => m.id)))); } catch { /* not saved */ }
}

const groupIds = (g: string): string[] => INCLUDED.filter((m) => m.category === g).map((m) => m.id);
const state = (ids: ReadonlySet<string>, g: string): 'true' | 'false' | 'mixed' => {
  const all = groupIds(g);
  const n = all.filter((i) => ids.has(i)).length;
  return n === 0 ? 'false' : n === all.length ? 'true' : 'mixed';
};

function html(prefix: string): string {
  const chips = SELECTION_GROUPS.map(([g, label]) => `<button type="button" class="chip" data-sel-group="${g}" aria-pressed="false">${esc(label)}</button>`).join('');
  const lists = SELECTION_GROUPS.map(([g, label]) => `<div class="sel-group"><strong>${esc(label)}</strong>${
    INCLUDED.filter((m) => m.category === g).map((m) => `<label><input type="checkbox" data-sel-id="${esc(m.id)}"> ${esc(m.name)}</label>`).join('')}</div>`).join('');
  return `<fieldset class="sel" id="${prefix}-sel"><legend>Indices to include:</legend>
<div class="chips" role="group" aria-label="Index groups">${chips} <button type="button" data-sel-all>All</button> <button type="button" data-sel-none>None</button></div>
<details class="sel-details"><summary>Choose individual indices</summary><div class="sel-lists">${lists}</div></details>
<p class="hint" data-sel-count role="status"></p>
</fieldset>`;
}

export interface SelectionControl {
  get(): Set<string>;
  set(ids: Iterable<string>): void;
}

/**
 * Fills `host` with the control. `initial` (default: the saved selection) is the starting state; onChange runs after every
 * user change with the new set; the choice is saved to `storage` (localStorage unless given).
 */
export function mountSelection(
  host: HTMLElement, prefix: string, onChange: (ids: Set<string>) => void,
  opts: { initial?: Iterable<string>; storage?: SelectionStorage } = {},
): SelectionControl {
  host.innerHTML = html(prefix);
  const storage = opts.storage ?? defaultStorage();
  let ids = opts.initial ? new Set(opts.initial) : loadSelection(storage);
  const paint = (): void => {
    host.querySelectorAll<HTMLButtonElement>('[data-sel-group]').forEach((b) => {
      const s = state(ids, b.dataset['selGroup']!);
      b.setAttribute('aria-pressed', s);
      b.classList.toggle('mixed', s === 'mixed');
    });
    host.querySelectorAll<HTMLInputElement>('[data-sel-id]').forEach((c) => { c.checked = ids.has(c.dataset['selId']!); });
    host.querySelector('[data-sel-count]')!.textContent = ids.size === 0
      ? 'No indices selected: nothing is shown or exported.'
      : `${ids.size} of ${INCLUDED.length} indices selected. Every index is still calculated; this only chooses what is shown and exported.`;
  };
  const apply = (next: Set<string>): void => { ids = next; paint(); saveSelection(ids, storage); onChange(new Set(ids)); };
  host.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b || !host.contains(b)) return;
    const next = new Set(ids);
    if (b.dataset['selGroup']) {
      const g = b.dataset['selGroup'];
      const on = state(ids, g) !== 'true';
      for (const i of groupIds(g)) { if (on) next.add(i); else next.delete(i); }
    } else if (b.hasAttribute('data-sel-all')) for (const m of INCLUDED) next.add(m.id);
    else if (b.hasAttribute('data-sel-none')) next.clear();
    else return;
    apply(next);
  });
  host.addEventListener('change', (e) => {
    const c = e.target as HTMLInputElement;
    if (!c.dataset['selId']) return;
    const next = new Set(ids);
    if (c.checked) next.add(c.dataset['selId']); else next.delete(c.dataset['selId']);
    apply(next);
  });
  paint();
  return {
    get: () => new Set(ids),
    set: (v) => { ids = new Set(v); paint(); },
  };
}

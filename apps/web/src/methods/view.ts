import { hydrateFormulas } from '../calculate/mathml';
import { methodsHtml } from './entries';

/** Methods page: search, category chips, and "#/methods/<id>" deep links. */
export function mountMethods(root: HTMLElement, methodId?: string): () => void {
  root.innerHTML = methodsHtml();
  hydrateFormulas(root);
  const entries = [...root.querySelectorAll<HTMLDetailsElement>('details.method')];
  const search = root.querySelector<HTMLInputElement>('#m-search')!;
  let cat = 'all';

  function apply(): void {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const d of entries) {
      const ok = (cat === 'all' || d.dataset['cat'] === cat) && (q === '' || d.dataset['search']!.includes(q));
      d.hidden = !ok;
      if (ok) shown++;
    }
    for (const sec of ['#m-main', '#m-excluded']) {
      const s = root.querySelector<HTMLElement>(sec)!;
      s.hidden = ![...s.querySelectorAll<HTMLDetailsElement>('details.method')].some((d) => !d.hidden);
    }
    root.querySelector('#m-count')!.textContent = `${shown} of ${entries.length} entries shown.`;
  }
  root.addEventListener('input', (e) => { if ((e.target as HTMLElement).id === 'm-search') apply(); });
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-chip]');
    if (!b) return;
    cat = b.dataset['chip']!;
    root.querySelectorAll<HTMLButtonElement>('[data-chip]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    apply();
  });
  apply();

  if (methodId) {
    const target = entries.find((d) => d.dataset['id'] === methodId);
    // Defer: the router scrolls to the top after mounting a page.
    if (target) { target.open = true; requestAnimationFrame(() => target.scrollIntoView()); }
  }
  return () => undefined;
}

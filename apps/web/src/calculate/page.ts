import { mountCalculate } from './view';
import { mountUpload } from '../upload/view';
import guideHtml from './guide.html?raw';

export type Mode = 'manual' | 'upload';

const TABS: Array<[Mode, string]> = [['upload', 'Upload file (many people)'], ['manual', 'Enter values (one person)']];

/** Calculate page: accessible tabs (roving tabindex, arrow keys, Home/End) over the two modes. */
export function mountCalculatePage(root: HTMLElement, initial: Mode): () => void {
  root.innerHTML = `${guideHtml}<div role="tablist" aria-label="Input method" class="tabs">${TABS.map(([m, label]) =>
    `<button type="button" role="tab" id="tab-${m}" aria-controls="panel-${m}" data-mode="${m}">${label}</button>`).join('')}</div>
<div role="tabpanel" id="panel-upload" aria-labelledby="tab-upload"></div>
<div role="tabpanel" id="panel-manual" aria-labelledby="tab-manual" hidden></div>`;
  const tab = (m: Mode) => root.querySelector<HTMLButtonElement>(`#tab-${m}`)!;
  const panel = (m: Mode) => root.querySelector<HTMLElement>(`#panel-${m}`)!;
  const disposers = [mountCalculate(panel('manual')), mountUpload(panel('upload'))];

  function select(m: Mode, focus = false): void {
    for (const [k] of TABS) {
      const on = k === m;
      tab(k).setAttribute('aria-selected', String(on));
      tab(k).tabIndex = on ? 0 : -1;
      panel(k).hidden = !on;
    }
    if (focus) tab(m).focus();
    try { history.replaceState(null, '', m === 'manual' ? '#/?mode=manual' : '#/'); } catch { /* ignore */ }
  }
  root.querySelector('[role="tablist"]')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-mode]');
    if (b) select(b.dataset['mode'] as Mode);
  });
  root.querySelector('[role="tablist"]')!.addEventListener('keydown', (e) => {
    const ev = e as KeyboardEvent;
    const cur = TABS.findIndex(([m]) => tab(m).getAttribute('aria-selected') === 'true');
    let next = cur;
    if (ev.key === 'ArrowRight') next = (cur + 1) % TABS.length;
    else if (ev.key === 'ArrowLeft') next = (cur + TABS.length - 1) % TABS.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = TABS.length - 1;
    else return;
    ev.preventDefault();
    select(TABS[next]![0], true);
  });
  select(initial);
  return () => disposers.forEach((d) => d());
}

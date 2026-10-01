import type { Route } from './router';
import { methodCounts } from './counts';

export const PRIVACY_STATEMENT =
  'Your data are processed locally in your browser and are not uploaded to a server for calculation.';
export const SURROGATE_NOTE =
  'These are surrogate indices of insulin sensitivity, not direct measurements, and are not a diagnosis.';

const NAV: Array<[Route, string]> = [
  ['/', 'Home'], ['/calculate', 'Calculate'], ['/batch', 'Batch'], ['/methods', 'Methods'], ['/about', 'About'],
];

export function landing(): string {
  const c = methodCounts();
  return `
<h1>ISAT</h1>
<p class="subtitle">Insulin Sensitivity Analysis Tool</p>
<p>Calculate and explore insulin sensitivity indices from metabolic data.</p>
<p class="actions">
  <a class="button primary" href="#/calculate">Start calculation</a>
  <a class="button" href="#/batch">Upload data</a>
  <a class="button" href="#/batch">Batch analysis</a>
  <a class="button" href="#/methods">Methods</a>
</p>
<p id="method-counts"><strong>${c.available} methods available</strong>; ${c.notIncluded} listed but not included.</p>
<p class="note">${PRIVACY_STATEMENT}</p>
<p class="note">${SURROGATE_NOTE}</p>`;
}

function placeholder(title: string): string {
  return `<h1>${title}</h1>\n<p>This page is under construction in this release.</p>`;
}

export function pageFor(route: Route): string {
  switch (route) {
    case '/': return landing();
    case '/calculate': return placeholder('Calculate');
    case '/batch': return placeholder('Batch analysis');
    case '/methods': return placeholder('Methods');
    case '/about': return placeholder('About');
  }
}

export function shell(route: Route): string {
  const nav = NAV.map(([r, label]) =>
    `<a href="#${r}"${r === route ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return `
<a class="skip" href="#main">Skip to content</a>
<header><a class="brand" href="#/">ISAT</a><nav aria-label="Main">${nav}</nav></header>
<main id="main" tabindex="-1">${pageFor(route)}</main>
<footer>
  <span>ISAT v${__ISAT_VERSION__}</span>
  <a href="https://github.com/sufyansuleman/isat">Source on GitHub</a>
  <span>MIT licence</span>
</footer>`;
}

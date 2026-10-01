import type { Route } from './router';
import { methodCounts } from './counts';
import aboutHtml from './about.html?raw';

export const PRIVACY_STATEMENT =
  'Your data are processed locally in your browser and are not uploaded to a server for calculation.';
export const SURROGATE_NOTE =
  'These are surrogate indices of insulin sensitivity, not direct measurements, and are not a diagnosis.';

const NAV: Array<[Route, string]> = [
  ['/', 'Calculate'], ['/methods', 'Methods'], ['/about', 'About'],
];

export function landing(): string {
  const c = methodCounts();
  return `
<h1>ISAT</h1>
<p class="subtitle">Insulin Sensitivity Analysis Tool</p>
<p class="lede">Calculate and explore insulin sensitivity indices from metabolic data, for one person or a whole file, entirely in your browser.</p>
<p class="notice">${PRIVACY_STATEMENT}</p>
<p class="notice">${SURROGATE_NOTE}</p>`;
}

export function pageFor(route: Route): string {
  switch (route) {
    case '/': return `${landing()}<div id="calculate-root"></div>`;
    case '/methods': return '<h1>Methods</h1><div id="methods-root"></div>';
    case '/about': return aboutHtml;
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

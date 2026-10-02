/**
 * Anonymous usage counting with GoatCounter (no cookies, no personal data).
 * Only page paths and named events are sent; never any value entered or uploaded.
 * Uses GoatCounter's image endpoint so no third-party script runs on the page.
 * Counts only on the published site (not local copies or development builds).
 */
export const COUNT_ENDPOINT = 'https://isatweb.goatcounter.com/count';
const SITE_HOST = 'sufyansuleman.github.io';

function enabled(): boolean {
  try {
    return location.hostname === SITE_HOST;
  } catch { return false; }
}

/** GoatCounter request URL for a path or event (exported for tests). */
export function countUrl(path: string, opts: { title?: string; event?: boolean } = {}): string {
  const q = new URLSearchParams({ p: path });
  if (opts.title) q.set('t', opts.title);
  if (opts.event) q.set('e', 'true');
  q.set('rnd', Math.random().toString(36).slice(2, 10));
  return `${COUNT_ENDPOINT}?${q.toString()}`;
}

function send(url: string): void {
  if (!enabled()) return;
  try { new Image().src = url; } catch { /* counting must never break the page */ }
}

/** Page view for a hash route, recorded as /isat/<route>. */
export function countPage(route: string): void {
  send(countUrl(`/isat${route === '/' ? '/' : route}`, { title: document.title }));
}

/** Rows bands, so the event says roughly how large a file was without its exact size. */
export function rowBand(n: number): string {
  if (n <= 100) return '1-100';
  if (n <= 1000) return '101-1000';
  if (n <= 10000) return '1001-10000';
  return '10001-100000';
}

/** Named event, e.g. "calc-single" or "upload-101-1000". */
export function countEvent(name: string): void {
  send(countUrl(name, { event: true }));
}

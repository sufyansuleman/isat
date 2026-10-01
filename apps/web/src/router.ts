export const ROUTES = ['/', '/calculate', '/methods', '/about'] as const;
export type Route = (typeof ROUTES)[number];
export type Mode = 'manual' | 'upload';

export interface Location { route: Route; mode: Mode }

/**
 * Map a location hash to a route and, for the calculate page, an input mode.
 * "#/calculate?mode=upload", "#/calculate/upload" and the retired "#/batch" open upload mode.
 * Unknown or empty hashes fall back to the landing page.
 */
export function parseLocation(hash: string): Location {
  const raw = hash.replace(/^#/, '');
  const [pathPart = '', query = ''] = raw.split('?', 2);
  let p = pathPart === '' ? '/' : pathPart;
  if (p.length > 1) p = p.replace(/\/+$/, '');
  if (p === '/batch' || p === '/calculate/upload') return { route: '/calculate', mode: 'upload' };
  if (!(ROUTES as readonly string[]).includes(p)) return { route: '/', mode: 'manual' };
  const mode: Mode = p === '/calculate' && new URLSearchParams(query).get('mode') === 'upload' ? 'upload' : 'manual';
  return { route: p as Route, mode };
}

export function parseHash(hash: string): Route {
  return parseLocation(hash).route;
}

/** Call `render` with the current location now and on every hash change. Returns an unsubscribe function. */
export function startRouter(render: (route: Route, mode: Mode) => void): () => void {
  const run = () => { const l = parseLocation(window.location.hash); render(l.route, l.mode); };
  window.addEventListener('hashchange', run);
  run();
  return () => window.removeEventListener('hashchange', run);
}

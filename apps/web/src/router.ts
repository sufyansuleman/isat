export const ROUTES = ['/', '/methods', '/about'] as const;
export type Route = (typeof ROUTES)[number];
export type Mode = 'manual' | 'upload';

export interface Location { route: Route; mode: Mode; methodId?: string }

/**
 * Map a location hash to a route and, for the calculate page, an input mode.
 * Calculate is the home page and opens on the upload tab (the main use: research files).
 * "#/?mode=manual" and the older "#/calculate" open the one-person tab; "#/?mode=upload",
 * "#/calculate/upload" and the retired "#/batch" open the upload tab.
 * Unknown or empty hashes fall back to the landing page.
 */
export function parseLocation(hash: string): Location {
  const raw = hash.replace(/^#/, '');
  const [pathPart = '', query = ''] = raw.split('?', 2);
  let p = pathPart === '' ? '/' : pathPart;
  if (p.length > 1) p = p.replace(/\/+$/, '');
  const mm = /^\/methods\/([A-Za-z0-9_]+)$/.exec(p);
  if (mm) return { route: '/methods', mode: 'manual', methodId: mm[1] };
  if (p === '/batch' || p === '/calculate/upload') return { route: '/', mode: 'upload' };
  const q = new URLSearchParams(query).get('mode');
  if (p === '/calculate') return { route: '/', mode: q === 'upload' ? 'upload' : 'manual' };
  if (!(ROUTES as readonly string[]).includes(p)) return { route: '/', mode: 'upload' };
  const mode: Mode = p === '/' && q === 'manual' ? 'manual' : 'upload';
  return { route: p as Route, mode };
}

export function parseHash(hash: string): Route {
  return parseLocation(hash).route;
}

/** Call `render` with the current location now and on every hash change. Returns an unsubscribe function. */
export function startRouter(render: (route: Route, mode: Mode, methodId?: string) => void): () => void {
  const run = () => { const l = parseLocation(window.location.hash); render(l.route, l.mode, l.methodId); };
  window.addEventListener('hashchange', run);
  run();
  return () => window.removeEventListener('hashchange', run);
}

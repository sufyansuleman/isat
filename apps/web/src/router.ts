export const ROUTES = ['/', '/calculate', '/batch', '/methods', '/about'] as const;
export type Route = (typeof ROUTES)[number];

/** Map a location hash (e.g. "#/batch") to a known route; unknown or empty hashes fall back to "/". */
export function parseHash(hash: string): Route {
  let p = hash.replace(/^#/, '');
  if (p === '') return '/';
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return (ROUTES as readonly string[]).includes(p) ? (p as Route) : '/';
}

/** Call `render` with the current route now and on every hash change. Returns an unsubscribe function. */
export function startRouter(render: (route: Route) => void): () => void {
  const run = () => render(parseHash(window.location.hash));
  window.addEventListener('hashchange', run);
  run();
  return () => window.removeEventListener('hashchange', run);
}

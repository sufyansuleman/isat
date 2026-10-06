// Same source as the web app's version (apps/web/vite.config.ts): the root package.json.
// The bundled binary cannot read package.json at runtime: scripts/bundle.mjs inlines __ISAT_VERSION__.
import rootPkg from '../../../package.json' with { type: 'json' };

declare const __ISAT_VERSION__: string | undefined;

export const ISAT_VERSION: string = typeof __ISAT_VERSION__ === 'string' ? __ISAT_VERSION__ : rootPkg.version;

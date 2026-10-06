// Same source as the web app's version (apps/web/vite.config.ts): the root package.json.
import rootPkg from '../../../package.json' with { type: 'json' };

export const ISAT_VERSION: string = rootPkg.version;

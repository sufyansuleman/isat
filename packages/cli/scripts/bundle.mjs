// Bundles src/main.ts + @isat/core into one ESM file: dist/isat.mjs (only node: built-ins stay external).
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;

await build({
  entryPoints: [resolve(here, '..', 'src', 'main.ts')],
  outfile: resolve(here, '..', 'dist', 'isat.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  define: { __ISAT_VERSION__: JSON.stringify(version) },
  legalComments: 'none',
  // Deno only resolves Node built-ins with the node: prefix; esbuild strips it, so put it back.
  plugins: [{
    name: 'node-prefix',
    setup(b) {
      const names = new Set(builtinModules.filter((m) => !m.startsWith('_')));
      b.onResolve({ filter: /^[a-z_/]+$/ }, (a) => (names.has(a.path) ? { path: 'node:' + a.path, external: true } : undefined));
      b.onResolve({ filter: /^node:/ }, (a) => ({ path: a.path, external: true }));
    },
  }],
  logLevel: 'info',
});

// Bundles src/main.ts + @isat/core into one ESM file: dist/isat.mjs (only node: built-ins stay external).
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  logLevel: 'info',
});

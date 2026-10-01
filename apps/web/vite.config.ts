import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';

const rootPkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "connect-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'";

/** Production builds only: strict CSP so the shipped page cannot contact any server. */
function cspPlugin(): Plugin {
  return {
    name: 'isat-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
      ],
    },
  };
}

export default defineConfig({
  base: '/isat/',
  define: { __ISAT_VERSION__: JSON.stringify(rootPkg.version) },
  plugins: [cspPlugin()],
  build: { modulePreload: { polyfill: false } },
  test: { environment: 'node' },
});

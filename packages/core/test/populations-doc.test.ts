import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { populationsMarkdown } from '../../../scripts/populations';

describe('docs/derivation-populations.md', () => {
  it('is up to date with the method files (run `npm run docs` if this fails)', () => {
    const onDisk = readFileSync(new URL('../../../docs/derivation-populations.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(onDisk).toBe(populationsMarkdown());
  });
});

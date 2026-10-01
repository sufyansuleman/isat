import { describe, it, expect } from 'vitest';
import { parseHash, ROUTES } from '../src/router';

describe('parseHash', () => {
  it('maps known routes', () => {
    for (const r of ROUTES) expect(parseHash('#' + r)).toBe(r);
  });
  it('treats empty, "#" and unknown hashes as landing', () => {
    expect(parseHash('')).toBe('/');
    expect(parseHash('#')).toBe('/');
    expect(parseHash('#/nope')).toBe('/');
  });
  it('ignores a trailing slash', () => {
    expect(parseHash('#/batch/')).toBe('/batch');
  });
});

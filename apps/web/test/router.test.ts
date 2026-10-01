import { describe, it, expect } from 'vitest';
import { parseHash, parseLocation, ROUTES } from '../src/router';

describe('parseHash', () => {
  it('maps known routes; #/calculate is an alias of the merged home page', () => {
    for (const r of ROUTES) expect(parseHash('#' + r)).toBe(r);
    expect(parseHash('#/calculate')).toBe('/');
  });
  it('treats empty, "#" and unknown hashes as landing', () => {
    expect(parseHash('')).toBe('/');
    expect(parseHash('#')).toBe('/');
    expect(parseHash('#/nope')).toBe('/');
  });
  it('ignores a trailing slash', () => {
    expect(parseHash('#/methods/')).toBe('/methods');
  });

  it('opens upload mode from the query, the sub-path and the retired batch route', () => {
    expect(parseLocation('#/calculate?mode=upload')).toEqual({ route: '/', mode: 'upload' });
    expect(parseLocation('#/?mode=upload')).toEqual({ route: '/', mode: 'upload' });
    expect(parseLocation('#/calculate/upload')).toEqual({ route: '/', mode: 'upload' });
    expect(parseLocation('#/batch')).toEqual({ route: '/', mode: 'upload' });
    expect(parseLocation('#/calculate')).toEqual({ route: '/', mode: 'manual' });
    expect(parseLocation('#/methods?mode=upload').mode).toBe('manual');
  });
});

// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { countUrl, rowBand, countPage, countEvent, COUNT_ENDPOINT } from '../src/count';

describe('anonymous counter', () => {
  it('builds GoatCounter URLs with only a path or event name', () => {
    const u = new URL(countUrl('/isat/methods', { title: 'ISAT - methods' }));
    expect(`${u.origin}${u.pathname}`).toBe(COUNT_ENDPOINT);
    expect(u.searchParams.get('p')).toBe('/isat/methods');
    expect(u.searchParams.get('e')).toBeNull();
    const e = new URL(countUrl('upload-101-1000', { event: true }));
    expect(e.searchParams.get('e')).toBe('true');
    expect([...e.searchParams.keys()].sort()).toEqual(['e', 'p', 'rnd']);
  });
  it('reports file size only as a band', () => {
    expect(rowBand(10)).toBe('1-100');
    expect(rowBand(500)).toBe('101-1000');
    expect(rowBand(5000)).toBe('1001-10000');
    expect(rowBand(100000)).toBe('10001-100000');
  });
  it('sends nothing outside the published site', () => {
    const before = document.querySelectorAll('img').length;
    expect(() => { countPage('/'); countEvent('calc-single'); }).not.toThrow();
    expect(document.querySelectorAll('img').length).toBe(before);
  });
});

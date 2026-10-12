// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { pageFor } from '../src/pages';
import { mountSelection } from '../src/selection';

describe('pointers to the Methods page', () => {
  it('main page header links to the Methods page', () => {
    const d = document.createElement('div');
    d.innerHTML = pageFor('/');
    const p = d.querySelector('.methods-pointer')!;
    expect(p.querySelector('a')!.getAttribute('href')).toBe('#/methods');
    expect(p.textContent).toContain('original reference');
  });
  it('index selection box links to the Methods page', () => {
    const host = document.createElement('div');
    mountSelection(host, 'x', () => {}, { initial: [], storage: { load: () => null, save: () => {} } } as never);
    expect(host.querySelector('.methods-pointer a')!.getAttribute('href')).toBe('#/methods');
  });
});

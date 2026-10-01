// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { methodSpecs } from '@isat/core';
import { latexToMathml } from '../src/calculate/mathml';

const BS = String.fromCharCode(92);
const formulas: Array<[string, string]> = [];
for (const s of Object.values(methodSpecs) as any[]) {
  for (const m of Array.isArray(s.methods) ? s.methods : [s]) if (m.formula_latex) formulas.push([m.id, m.formula_latex]);
}

describe('latexToMathml', () => {
  it('finds the formulas', () => expect(formulas.length).toBeGreaterThan(25));
  for (const [id, f] of formulas) {
    it(`converts ${id} with no TeX left over`, () => {
      const math = latexToMathml(f);
      expect(math.localName).toBe('math');
      expect(math.getAttribute('display')).toBe('block');
      expect(math.namespaceURI).toBe('http://www.w3.org/1998/Math/MathML');
      expect(math.textContent).not.toContain(BS);
      expect(math.outerHTML).not.toContain(BS);
    });
  }
  it('builds fractions and scripts', () => {
    const m = latexToMathml(BS + 'frac{I_{0,' + BS + 'mu U/mL}}{2}');
    expect(m.querySelector('mfrac')).not.toBeNull();
    expect(m.querySelector('msub')).not.toBeNull();
  });
  it('throws on unsupported commands', () => {
    expect(() => latexToMathml(BS + 'int x')).toThrow();
    expect(() => latexToMathml('{x')).toThrow();
  });
});

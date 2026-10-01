import { describe, it, expect } from 'vitest';
import { registry, methodSpecs } from '@isat/core';
import { methodCounts } from '../src/counts';
import { landing, pageFor, PRIVACY_STATEMENT } from '../src/pages';

// Independent derivation from the YAML specs (flattening grouped files).
const specs: Array<{ id: string; deferred?: unknown }> = [];
for (const s of Object.values(methodSpecs) as any[]) {
  if (Array.isArray(s.methods)) specs.push(...s.methods); else specs.push(s);
}

describe('landing counts', () => {
  it('match the registry and the YAML specs', () => {
    const c = methodCounts();
    const reg = registry.filter((m) => m.deferredReason === undefined).length;
    const notIncl = registry.filter((m) => m.deferredReason !== undefined).length;
    const fromSpecs = registry.filter((m) => !specs.find((s) => s.id === m.id)?.deferred).length;
    expect(c.available).toBe(reg);
    expect(c.notIncluded).toBe(notIncl);
    expect(c.available).toBe(fromSpecs);
    expect(c.available + c.notIncluded).toBe(registry.length);
  });
  it('are rendered on the merged Calculate page with the privacy statement', () => {
    const c = methodCounts();
    const html = pageFor('/');
    expect(html).toContain('id="calculate-root"');
    expect(landing()).toContain('href="#/methods"');
    expect(html).toContain(`${c.available} methods available`);
    expect(html).toContain(`${c.notIncluded} listed but not included`);
    expect(html).toContain(PRIVACY_STATEMENT);
  });
  it('about page has author, citation and privacy statement', () => {
    const a = pageFor('/about');
    expect(a).toContain('0000-0001-6612-6915');
    expect(a).toContain('10.1210/clinem/dgae275');
    expect(a).toContain('not sent to any server');
    expect(a).not.toContain('under construction');
  });
});

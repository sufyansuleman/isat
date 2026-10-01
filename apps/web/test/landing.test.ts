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
  it('are rendered on the landing page with the privacy statement', () => {
    const c = methodCounts();
    const html = landing();
    expect(html).toContain(`${c.available} methods available`);
    expect(html).toContain(`${c.notIncluded} listed but not included`);
    expect(html).toContain(PRIVACY_STATEMENT);
  });
  it('placeholder pages say under construction', () => {
    expect(pageFor('/calculate')).toContain('under construction in this release');
  });
});

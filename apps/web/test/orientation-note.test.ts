// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { registry } from '@isat/core';
import { orientationNoteHtml } from '../src/calculate/results';

describe('orientation note', () => {
  it('explains both directions and lists every included index once', () => {
    const d = document.createElement('div');
    d.innerHTML = orientationNoteHtml();
    const text = d.textContent!;
    expect(text).toContain('insulin-resistance');
    expect(text).toContain('insulin-sensitivity');
    const [res, sen] = [...d.querySelectorAll('details p')].map((p) => p.textContent!);
    expect(res).toContain('FIRI');
    expect(res).toContain('HOMA-IR');
    expect(sen).toContain('QUICKI');
    const incl = registry.filter((m) => m.deferredReason === undefined);
    for (const m of incl) expect((m.direction === 'higher_more_resistant' ? res : sen)).toContain(m.name);
  });
});

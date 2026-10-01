import { registry } from './registry';
import type { Result } from './types';

export type OrientMode = 'published' | 'sensitivity';

const NOTE = 'negated published index (InsuSensCalc convention): higher = more sensitive';

/**
 * 'published' (default): unchanged. 'sensitivity': negates every result whose direction is resistant
 * and whose YAML legacy relation is `negated` (InsuSensCalc `_inv` convention); id gets `_inv`.
 */
export function orient(results: Result[], mode: OrientMode = 'published'): Result[] {
  if (mode === 'published') return results;
  const negated = new Set(registry.filter((m) => m.legacy.relation === 'negated').map((m) => m.id));
  return results.map((r) =>
    r.direction === 'higher_more_resistant' && negated.has(r.id)
      ? {
          ...r,
          id: `${r.id}_inv`,
          value: r.value === null ? null : -r.value,
          direction: 'higher_more_sensitive',
          orientation: 'sensitivity',
          details: { ...r.details, orientation_note: NOTE },
        }
      : r,
  );
}

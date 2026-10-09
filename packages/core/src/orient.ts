import type { Result } from './types';

export type OrientMode = 'published' | 'sensitivity';

const NOTE = 'negated published index (InsuSensCalc convention): higher = more sensitive';

/**
 * 'published' (default): unchanged. 'sensitivity': negates every result whose direction is resistant
 * (InsuSensCalc `_inv` convention: higher = more sensitive for every index); id gets `_inv`.
 * This includes FIRI, which InsuSensCalc 0.1.0 itself left un-negated (column `Firi`).
 */
export function orient(results: Result[], mode: OrientMode = 'published'): Result[] {
  if (mode === 'published') return results;
  return results.map((r) =>
    r.direction === 'higher_more_resistant'
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

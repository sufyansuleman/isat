// Export deterministic test vectors and ISAT transform / describe / Spearman outputs for independent checking in R.
// Usage (repo root): npx vite-node validation/export_transform.ts
import { writeFileSync } from 'node:fs';
import { describe, qnorm, spearman, transform, type TransformKind } from '../packages/core/src/index';

let seed = 20240917;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const N = 80;
const nul = (v: number) => (Number.isNaN(v) ? null : v);
const nulls = (a: ArrayLike<number>) => Array.from(a, nul);

// x1: ties, missings, negatives. x2: correlated with x1, other missingness. x3: positive and skewed, with ties.
const x1 = Array.from({ length: N }, (_, i) => (i % 9 === 4 ? null : Math.round((rnd() * 20 - 6) * 2) / 2));
const x2 = Array.from({ length: N }, (_, i) => (i % 7 === 3 || i < 5 ? null : Math.round(((x1[i] ?? 0) * 0.6 + rnd() * 8) * 10) / 10));
const x3 = Array.from({ length: N }, (_, i) => (i % 11 === 6 ? null : Math.round(Math.exp(rnd() * 3) * 4) / 4));
const sex = Array.from({ length: N }, (_, i) => (i % 13 === 8 ? null : rnd() < 0.45 ? 'male' : 'female'));
const vars = { x1, x2, x3 } as const;
const kinds: TransformKind[] = ['log', 'z', 'rint'];

const transforms: Record<string, unknown> = {};
for (const [name, v] of Object.entries(vars)) {
  for (const kind of kinds) {
    const all = transform(v, kind);
    const by = transform(v, kind, { groups: sex });
    transforms[`${name}_${kind}`] = { values: nulls(all.values), non_positive: all.nonPositive };
    transforms[`${name}_${kind}_bysex`] = { values: nulls(by.values), non_positive: by.nonPositive, group_n: by.groupN };
  }
}
const stats = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, describe(v)]));
const names = Object.keys(vars);
const spear: Record<string, unknown> = {};
for (const a of names) for (const b of names) spear[`${a}__${b}`] = spearman(vars[a as keyof typeof vars], vars[b as keyof typeof vars]);
const probs = [0.0001, 0.001, 0.01, 0.025, 0.1, 0.25, 0.5, 0.75, 0.9, 0.975, 0.99, 0.999, 0.9999];

writeFileSync('validation/fixtures/transform_results.json', JSON.stringify({
  inputs: { x1, x2, x3, sex }, transforms, describe: stats, spearman: spear, qnorm: probs.map((p) => ({ p, q: qnorm(p) })),
}, null, 2));
console.log(`wrote ${Object.keys(transforms).length} transforms, ${names.length} describe, ${Object.keys(spear).length} spearman, ${probs.length} qnorm`);

// Throughput of the pure chunk processor. Run from apps/web: npx vite-node scripts/bench-batch.ts
import type { Inputs } from '@isat/core';
import { composeCsv, runBatch } from '../src/upload/batch';

const N = 100_000;
const rows: Inputs[] = [];
const ids: string[] = [];
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
for (let k = 0; k < N; k++) {
  const g0 = 4.5 + rnd() * 2, i0 = 20 + rnd() * 100;
  rows.push({
    age: 30 + Math.floor(rnd() * 40), sex: rnd() < 0.5 ? 'male' : 'female', weight: 60 + rnd() * 40, bmi: 20 + rnd() * 12, waist: 70 + rnd() * 40,
    tg: 0.8 + rnd() * 2, hdl: 0.9 + rnd(), ffa: { 0: 0.2 + rnd() * 0.5 }, fat_mass: 12 + rnd() * 20,
    glucose: { 0: g0, 30: g0 + 2 + rnd() * 2, 60: g0 + 1 + rnd() * 3, 90: g0 + rnd() * 2, 120: g0 + rnd() * 2 },
    insulin: { 0: i0, 30: i0 * (3 + rnd() * 4), 60: i0 * (3 + rnd() * 5), 90: i0 * (2 + rnd() * 3), 120: i0 * (1.5 + rnd() * 3) },
  });
  ids.push(`P${k + 1}`);
}
const t0 = performance.now();
const chunks = [];
for (const m of runBatch({ type: 'run', rows, ids, settings: {}, avignon: 'cohort' })) if (m.type === 'chunk') chunks.push(m.payload);
const t1 = performance.now();
const csv = composeCsv(chunks, 'sensitivity', true).join('');
const t2 = performance.now();
console.log(`rows: ${N}`);
console.log(`calculate: ${((t1 - t0) / 1000).toFixed(2)} s = ${Math.round(N / ((t1 - t0) / 1000))} rows/s`);
console.log(`compose CSV: ${((t2 - t1) / 1000).toFixed(2)} s, ${(csv.length / 1e6).toFixed(1)} MB`);

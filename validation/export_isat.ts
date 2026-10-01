// Export ISAT results for the validation fixtures and edge cases, for independent checking in R.
// Usage (repo root): npx vite-node validation/export_isat.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { calculateBatch, calculateAll, parseCsv, parseWideRow, registry } from '../packages/core/src/index';
import type { Inputs } from '../packages/core/src/types';

const csv = readFileSync('validation/fixtures/inputs.csv', 'utf8');
const rows = parseCsv(csv);
const parsed = rows.map((r) => parseWideRow(r));
const inputs = parsed.map((p) => p.inputs as Inputs);

const pack = (rs: ReturnType<typeof calculateAll>) =>
  Object.fromEntries(rs.map((r) => [r.id, { status: r.status, value: r.value, reasons: r.reasons, warnings: r.warnings }]));

const out: Record<string, unknown> = {
  methods: registry.map((m) => m.id),
  default: calculateBatch(inputs).map((rs, i) => ({ participant_id: rows[i]!.participant_id, results: pack(rs) })),
  sample_weight: calculateBatch(inputs, { avignon_weight: 'sample' }).map((rs, i) => ({
    participant_id: rows[i]!.participant_id,
    avignon_sim: rs.find((r) => r.id === 'avignon_sim')?.value ?? null,
  })),
};

// Edge cases: each must give 'error' or 'unavailable' with a reason, never a silent number.
const base: Inputs = parsed[3]!.inputs as Inputs; // NGT_M, complete row
const edge: Record<string, Inputs> = {
  empty: {},
  glucose_zero: { ...base, glucose: { ...base.glucose, 0: 0 } },
  insulin_negative: { ...base, insulin: { ...base.insulin, 0: -5 } },
  insulin_missing_0: { ...base, insulin: Object.fromEntries(Object.entries(base.insulin ?? {}).filter(([t]) => t !== '0')) },
  glucose_nan: { ...base, glucose: { ...base.glucose, 0: Number.NaN } },
  insulin_equals_1uU: { ...base, insulin: { ...base.insulin, 0: 6 } }, // 1 uU/mL -> log10 = 0
  no_sex: { ...base, sex: undefined },
  no_weight: { ...base, weight: undefined },
};
out.edge = Object.fromEntries(Object.entries(edge).map(([k, v]) => [k, pack(calculateAll(v))]));

writeFileSync('validation/fixtures/isat_results.json', JSON.stringify(out, null, 2));
console.log(`wrote ${out.methods && (out.methods as string[]).length} methods x ${inputs.length} rows + ${Object.keys(edge).length} edge cases`);

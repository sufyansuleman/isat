import { methodSpecs } from './generated/methods';
import { resolveSettings, type ConversionSettings } from './units';
import type { Direction, Inputs, Reference, Result } from './types';
import { BELFIORE_1998 } from './reference';
import { mk } from './indices/util';
import { quicki } from './indices/quicki';
import { firi } from './indices/firi';
import { belfioreBasal, belfioreIsiGly, belfioreIsiFfa } from './indices/belfiore';
import { homaIr, raynaud, isiBasal, igRatioBasal, bennett, hiri, ifc, liri, lipo, atiri } from './indices/fasting';
import {
  isi120, igRatio120, gutt, cederholm, matsuda3pt, matsudaAuc3pt, matsuda5pt,
  stumvollMod, stumvollDem, bigttSi, avignonSi0, avignonSi120, avignonSim, AVIGNON_1999_WEIGHT,
  type AvignonWeightSource,
} from './indices/ogtt';
import { revisedQuicki, mcauley, tyg, tgHdl, vai, lap, adipoIr } from './indices/lipid';

export type VerificationStatus = 'confirmed' | 'supported_secondary' | 'legacy_match' | 'provisional';
export type LegacyRelation = 'equal' | 'negated' | 'different' | 'none';

export interface RunExtra {
  avignon?: { w: number; source: AvignonWeightSource; warnings?: string[] };
}

export interface MethodEntry {
  id: string;
  name: string;
  category: string;
  direction: Direction;
  verification?: { status: VerificationStatus; detail?: string };
  legacy: { column: string | { male: string; female: string } | null; relation: LegacyRelation; scale_factor?: string };
  deferredReason?: string;
  needsReference: boolean;
  run: (inputs: Inputs, settings?: Partial<ConversionSettings>, reference?: Reference, extra?: RunExtra) => Result;
}

type Fn = (i: Inputs, s?: Partial<ConversionSettings>) => Result;
const plain: Record<string, Fn> = {
  quicki, firi, homa_ir: homaIr, raynaud, isi_basal: isiBasal, ig_ratio_basal: igRatioBasal,
  isi_120: isi120, ig_ratio_120: igRatio120, gutt, cederholm, matsuda_3pt: matsuda3pt,
  matsuda_auc_3pt: matsudaAuc3pt, matsuda_5pt: matsuda5pt, stumvoll_mod: stumvollMod,
  stumvoll_dem: stumvollDem, bigtt_si: bigttSi, avignon_si0: avignonSi0, avignon_si120: avignonSi120,
  bennett, hiri, ifc, liri, lipo, atiri, revised_quicki: revisedQuicki, mcauley, tyg, tg_hdl: tgHdl, vai, lap, adipo_ir: adipoIr,
};
type RFn = (i: Inputs, r?: Reference, s?: Partial<ConversionSettings>) => Result;
const withRef: Record<string, RFn> = {
  belfiore_basal: belfioreBasal, belfiore_isi_gly: belfioreIsiGly, belfiore_isi_ffa: belfioreIsiFfa,
};

/** Registry order (also the display order). */
const ORDER = [
  'homa_ir', 'quicki', 'firi', 'raynaud', 'isi_basal', 'ig_ratio_basal', 'belfiore_basal',
  'isi_120', 'ig_ratio_120', 'gutt', 'cederholm', 'matsuda_3pt', 'matsuda_auc_3pt', 'matsuda_5pt',
  'stumvoll_mod', 'stumvoll_dem', 'bigtt_si', 'avignon_si0', 'avignon_si120', 'belfiore_isi_gly',
  'revised_quicki', 'mcauley', 'tyg', 'tg_hdl', 'vai', 'lap', 'adipo_ir', 'belfiore_isi_ffa',
  'bennett', 'hiri', 'avignon_sim', 'ifc', 'liri', 'lipo', 'atiri', 'homa2',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Spec = Record<string, any>;
const flat: Record<string, Spec> = {};
for (const spec of Object.values(methodSpecs) as unknown as Spec[]) {
  if (Array.isArray(spec.methods)) for (const m of spec.methods) flat[m.id] = m;
  else flat[spec.id] = spec;
}

function build(id: string): MethodEntry {
  const sp = flat[id];
  if (!sp) throw new Error(`No YAML spec for method ${id}`);
  const legacy = {
    column: sp.legacy?.insusenscalc_column ?? null,
    relation: sp.legacy?.relation as LegacyRelation,
    scale_factor: sp.legacy?.scale_factor as string | undefined,
  };
  const base = {
    id, name: sp.name as string, category: sp.category as string, direction: sp.direction as Direction,
    verification: sp.verification as MethodEntry['verification'], legacy,
  };
  const provisional = (r: Result): Result =>
    base.verification?.status === 'provisional'
      ? { ...r, warnings: [...r.warnings, `Provisional method: ${base.verification.detail ?? 'formula not fully verified'}`] }
      : r;
  if (sp.deferred) {
    const reason = `not included in this version: ${sp.deferred.reason}`;
    return {
      ...base, deferredReason: sp.deferred.reason, needsReference: false,
      run: (_i, s) => mk(id, base.direction, resolveSettings(s), { status: 'unavailable', reasons: [reason] }),
    };
  }
  if (id === 'avignon_sim') {
    return {
      ...base, needsReference: false,
      run: (i, s, _r, x) => {
        const a = x?.avignon ?? { w: AVIGNON_1999_WEIGHT, source: 'avignon_1999' as const };
        return provisional(avignonSim(i, s, a.w, a.source, a.warnings));
      },
    };
  }
  if (plain[id]) { const f = plain[id]!; return { ...base, needsReference: false, run: (i, s) => provisional(f(i, s)) }; }
  const g = withRef[id];
  if (!g) throw new Error(`No implementation for method ${id}`);
  return { ...base, needsReference: true, run: (i, s, r) => provisional(g(i, r ?? BELFIORE_1998, s)) };
}

export const registry: MethodEntry[] = ORDER.map(build);

/**
 * One Result per registered method; never omits. Inputs are canonical units.
 * Belfiore methods use the default set belfiore_1998 unless `reference` is supplied.
 * Avignon Sim uses w = 0.137 (Avignon 1999) unless `avignon_weight` (a number) is given.
 */
export function calculateAll(
  inputs: Inputs,
  opts: { settings?: Partial<ConversionSettings>; reference?: Reference; avignon_weight?: number } = {},
): Result[] {
  const s = resolveSettings(opts.settings);
  const avignon: RunExtra['avignon'] =
    opts.avignon_weight === undefined
      ? { w: AVIGNON_1999_WEIGHT, source: 'avignon_1999' }
      : { w: opts.avignon_weight, source: 'user' };
  return registry.map((m) => m.run(inputs, s, opts.reference, { avignon }));
}

/**
 * Batch calculation: one result list per row. Avignon Sim defaults to w = 0.137 (Avignon 1999).
 * avignon_weight 'sample' opts in to the InsuSensCalc / Suleman 2024 data-driven weight
 * w = mean(Si120)/mean(Si0) over rows where both exist (needs >= 2 such rows, else 0.137 with a warning);
 * a number uses that weight.
 */
export function calculateBatch(
  rows: Inputs[],
  opts: { settings?: Partial<ConversionSettings>; reference?: Reference; avignon_weight?: 'sample' | number } = {},
): Result[][] {
  const s = resolveSettings(opts.settings);
  const aw = opts.avignon_weight ?? 'default';
  let avignon: RunExtra['avignon'];
  if (aw === 'default') avignon = { w: AVIGNON_1999_WEIGHT, source: 'avignon_1999' };
  else if (typeof aw === 'number') avignon = { w: aw, source: 'user' };
  else {
    const pairs = rows
      .map((r) => [avignonSi0(r, s), avignonSi120(r, s)] as const)
      .filter(([a, b]) => a.status === 'ok' && b.status === 'ok')
      .map(([a, b]) => [a.value as number, b.value as number] as const);
    if (pairs.length >= 2) {
      const m = (k: 0 | 1) => pairs.reduce((acc, p) => acc + p[k], 0) / pairs.length;
      avignon = {
        w: m(1) / m(0), source: 'sample',
        warnings: ['Sample-derived Avignon coefficient (InsuSensCalc / Suleman 2024 variant; ratio of mean Si120 to mean Si0 in the analysed cohort): the result depends on the cohort analysed.'],
      };
    } else {
      avignon = {
        w: AVIGNON_1999_WEIGHT, source: 'avignon_1999',
        warnings: ['Fewer than 2 rows have both Si0 and Si120; sample weight unavailable, using 0.137 (Avignon 1999).'],
      };
    }
  }
  return rows.map((r) => registry.map((m) => m.run(r, s, opts.reference, { avignon })));
}

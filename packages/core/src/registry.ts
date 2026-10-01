import { methodSpecs } from './generated/methods';
import { resolveSettings, type ConversionSettings } from './units';
import type { Direction, Inputs, Reference, Result } from './types';
import { BELFIORE_1998 } from './reference';
import { mk } from './indices/util';
import { quicki } from './indices/quicki';
import { firi } from './indices/firi';
import { belfioreBasal, belfioreIsiGly, belfioreIsiFfa } from './indices/belfiore';
import { homaIr, raynaud, isiBasal, igRatioBasal } from './indices/fasting';
import {
  isi120, igRatio120, gutt, cederholm, matsuda3pt, matsudaAuc3pt, matsuda5pt,
  stumvollMod, stumvollDem, bigttSi, avignonSi0, avignonSi120,
} from './indices/ogtt';
import { revisedQuicki, mcauley, tyg, tgHdl, vai, lap, adipoIr } from './indices/lipid';

export type VerificationStatus = 'confirmed' | 'supported_secondary' | 'provisional';
export type LegacyRelation = 'equal' | 'negated' | 'different' | 'none';

export interface MethodEntry {
  id: string;
  name: string;
  category: string;
  direction: Direction;
  verification?: { status: VerificationStatus; detail?: string };
  legacy: { column: string | { male: string; female: string } | null; relation: LegacyRelation };
  deferredReason?: string;
  needsReference: boolean;
  run: (inputs: Inputs, settings?: Partial<ConversionSettings>, reference?: Reference) => Result;
}

type Fn = (i: Inputs, s?: Partial<ConversionSettings>) => Result;
const plain: Record<string, Fn> = {
  quicki, firi, homa_ir: homaIr, raynaud, isi_basal: isiBasal, ig_ratio_basal: igRatioBasal,
  isi_120: isi120, ig_ratio_120: igRatio120, gutt, cederholm, matsuda_3pt: matsuda3pt,
  matsuda_auc_3pt: matsudaAuc3pt, matsuda_5pt: matsuda5pt, stumvoll_mod: stumvollMod,
  stumvoll_dem: stumvollDem, bigtt_si: bigttSi, avignon_si0: avignonSi0, avignon_si120: avignonSi120,
  revised_quicki: revisedQuicki, mcauley, tyg, tg_hdl: tgHdl, vai, lap, adipo_ir: adipoIr,
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
  const legacy = { column: sp.legacy?.insusenscalc_column ?? null, relation: sp.legacy?.relation as LegacyRelation };
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
  if (plain[id]) { const f = plain[id]!; return { ...base, needsReference: false, run: (i, s) => provisional(f(i, s)) }; }
  const g = withRef[id];
  if (!g) throw new Error(`No implementation for method ${id}`);
  return { ...base, needsReference: true, run: (i, s, r) => provisional(g(i, r ?? BELFIORE_1998, s)) };
}

export const registry: MethodEntry[] = ORDER.map(build);

/**
 * One Result per registered method; never omits. Inputs are canonical units.
 * Belfiore methods use the default set belfiore_1998 unless `reference` is supplied.
 */
export function calculateAll(
  inputs: Inputs,
  opts: { settings?: Partial<ConversionSettings>; reference?: Reference } = {},
): Result[] {
  const s = resolveSettings(opts.settings);
  return registry.map((m) => m.run(inputs, s, opts.reference));
}

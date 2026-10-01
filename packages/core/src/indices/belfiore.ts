import { toUnit, resolveSettings, type ConversionSettings, type Quantity } from '../units';
import type { Inputs, Reference, Result, Series } from '../types';
import { area, bad, error, has, mk, unavailable } from './util';

const DIR = 'higher_more_sensitive' as const;
const REF_MSG = 'requires normal-population reference means';
type Variant = '0_1_2h' | '0_2h';

function refInfo(r?: Reference) {
  if (!r) return { name: null, values: null };
  const { name, ...values } = r;
  return { name: name ?? 'custom', values };
}
const withRef = (res: Result, r?: Reference): Result => ({
  ...res,
  details: { ...res.details, reference_set: refInfo(r) },
});

function ratioIndex(a: number, aRef: number, b: number, bRef: number): number {
  return 2 / ((a / aRef) * (b / bRef) + 1);
}

/** Subject and reference both pass through the unit module (insulin -> uU/mL, glucose/FFA -> mmol/L). */
const conv = (v: number, q: Quantity, s: ConversionSettings) =>
  q === 'insulin' ? toUnit(v, q, 'pmol/L', 'uU/mL', s) : toUnit(v, q, 'mmol/L', 'mmol/L', s);

function checkPositive(vals: Record<string, number | undefined>): string[] {
  return Object.entries(vals)
    .filter(([, v]) => bad(v))
    .map(([k, v]) => `${k} must be a finite value > 0 (got ${String(v)}).`);
}

function pick(ser: Series, variant: Variant, label: string): Record<string, number | undefined> {
  const times = variant === '0_1_2h' ? [0, 60, 120] : [0, 120];
  return Object.fromEntries(times.map((t) => [`${label} at ${t} min`, ser[t]]));
}

function basalImpl(inputs: Inputs, reference?: Reference, settings?: Partial<ConversionSettings>): Result {
  const id = 'belfiore_basal';
  const s = resolveSettings(settings);
  const i = inputs.insulin?.[0];
  const g = inputs.glucose?.[0];
  const miss: string[] = [];
  if (i === undefined) miss.push('requires fasting insulin');
  if (g === undefined) miss.push('requires fasting glucose');
  if (miss.length) return unavailable(id, DIR, s, ...miss);
  if (reference?.insulin_0 === undefined || reference?.glucose_0 === undefined)
    return unavailable(id, DIR, s, REF_MSG);
  const errs = checkPositive({
    'Fasting insulin': i,
    'Fasting glucose': g,
    'Reference insulin_0': reference.insulin_0,
    'Reference glucose_0': reference.glucose_0,
  });
  if (errs.length) return error(id, DIR, s, ...errs);
  const v = ratioIndex(
    conv(i!, 'insulin', s), conv(reference.insulin_0, 'insulin', s),
    conv(g!, 'glucose', s), conv(reference.glucose_0, 'glucose', s),
  );
  return mk(id, DIR, s, {
    status: 'ok',
    value: v,
    details: { form: 'basal' },
  });
}

function glyImpl(inputs: Inputs, reference?: Reference, settings?: Partial<ConversionSettings>): Result {
  const id = 'belfiore_isi_gly';
  const s = resolveSettings(settings);
  const { insulin: I, glucose: G } = inputs;
  const miss: string[] = [];
  if (!has(I, 0)) miss.push('requires fasting insulin');
  if (!has(I, 120)) miss.push('requires 120-min insulin');
  if (!has(G, 0)) miss.push('requires fasting glucose');
  if (!has(G, 120)) miss.push('requires 120-min glucose');
  if (miss.length) return unavailable(id, DIR, s, ...miss);
  const variant: Variant = has(I, 60) && has(G, 60) ? '0_1_2h' : '0_2h';
  const warnings: string[] = [];
  if (variant === '0_2h' && (has(I, 60) || has(G, 60)))
    warnings.push('60-min value present for only one of insulin/glucose; using 0-2h area.');
  const rI = reference?.[`insulin_area_${variant}`];
  const rG = reference?.[`glucose_area_${variant}`];
  if (rI === undefined || rG === undefined)
    return mk(id, DIR, s, {
      status: 'unavailable',
      reasons: [`${REF_MSG} (${variant} area for insulin and glucose)`],
      warnings,
      details: { variant },
    });
  const errs = checkPositive({
    ...pick(I!, variant, 'insulin'),
    ...pick(G!, variant, 'glucose'),
    'Reference insulin area': rI,
    'Reference glucose area': rG,
  });
  if (errs.length) return mk(id, DIR, s, { status: 'error', reasons: errs, warnings, details: { variant } });
  const aI = area(I!, variant);
  const aG = area(G!, variant);
  const v = ratioIndex(
    conv(aI, 'insulin', s), conv(rI, 'insulin', s),
    conv(aG, 'glucose', s), conv(rG, 'glucose', s),
  );
  return mk(id, DIR, s, {
    status: 'ok',
    value: v,
    warnings,
    details: { variant, insulin_area: aI, glucose_area: aG },
  });
}

function ffaImpl(inputs: Inputs, reference?: Reference, settings?: Partial<ConversionSettings>): Result {
  const id = 'belfiore_isi_ffa';
  const s = resolveSettings(settings);
  const { insulin: I, ffa: F } = inputs;
  const miss: string[] = [];
  if (!has(I, 0)) miss.push('requires fasting insulin');
  if (!has(F, 0)) miss.push('requires fasting FFA');
  if (miss.length) return unavailable(id, DIR, s, ...miss);
  if (has(I, 120) && has(F, 120)) {
    const variant: Variant = has(I, 60) && has(F, 60) ? '0_1_2h' : '0_2h';
    const rI = reference?.[`insulin_area_${variant}`];
    const rF = reference?.[`ffa_area_${variant}`];
    if (rI === undefined || rF === undefined)
      return mk(id, DIR, s, {
        status: 'unavailable',
        reasons: [`${REF_MSG} (${variant} area for insulin and FFA)`],
        details: { form: 'area', variant },
      });
    const errs = checkPositive({
      ...pick(I!, variant, 'insulin'),
      ...pick(F!, variant, 'FFA'),
      'Reference insulin area': rI,
      'Reference FFA area': rF,
    });
    if (errs.length) return mk(id, DIR, s, { status: 'error', reasons: errs, details: { form: 'area', variant } });
    const aI = area(I!, variant);
    const aF = area(F!, variant);
    const v = ratioIndex(
      conv(aI, 'insulin', s), conv(rI, 'insulin', s),
      conv(aF, 'ffa', s), conv(rF, 'ffa', s),
    );
    return mk(id, DIR, s, { status: 'ok', value: v, details: { form: 'area', variant, insulin_area: aI, ffa_area: aF } });
  }
  // Basal form: the series lack 120-min values; an area is never synthesised.
  const rI = reference?.insulin_0;
  const rF = reference?.ffa_0;
  if (rI === undefined || rF === undefined)
    return mk(id, DIR, s, {
      status: 'unavailable',
      reasons: [`${REF_MSG} (basal insulin and FFA)`],
      details: { form: 'basal' },
    });
  const errs = checkPositive({
    'Fasting insulin': I![0],
    'Fasting FFA': F![0],
    'Reference insulin_0': rI,
    'Reference ffa_0': rF,
  });
  if (errs.length) return error(id, DIR, s, ...errs);
  const v = ratioIndex(
    conv(I![0]!, 'insulin', s), conv(rI, 'insulin', s),
    conv(F![0]!, 'ffa', s), conv(rF, 'ffa', s),
  );
  return mk(id, DIR, s, {
    status: 'ok',
    value: v,
    details: { form: 'basal' },
    warnings: ['Basal form used: insulin and FFA series lack 120-min values for an area.'],
  });
}

type BF = (i: Inputs, r?: Reference, s?: Partial<ConversionSettings>) => Result;
export const belfioreBasal: BF = (i, r, s) => withRef(basalImpl(i, r, s), r);
export const belfioreIsiGly: BF = (i, r, s) => withRef(glyImpl(i, r, s), r);
export const belfioreIsiFfa: BF = (i, r, s) => withRef(ffaImpl(i, r, s), r);

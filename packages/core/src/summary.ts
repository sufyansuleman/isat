import type { Inputs, Series } from './types';

export interface SeriesSummary {
  unit: string; // AUC unit, e.g. 'mmol/L*min'
  time_points: number[]; // minutes, all supplied values used
  auc: number | null; // trapezoid over all supplied time points
  time_weighted_mean: number | null; // auc / (t_last - t_first)
  reason?: string;
}

function summarizeSeries(s: Series | undefined, unit: string, label: string): SeriesSummary {
  const pts = Object.entries(s ?? {})
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    .map(([t, v]) => [Number(t), v as number] as const)
    .sort((a, b) => a[0] - b[0]);
  const time_points = pts.map((p) => p[0]);
  if (pts.length < 2)
    return { unit, time_points, auc: null, time_weighted_mean: null, reason: `requires at least two ${label} time points` };
  let auc = 0;
  for (let k = 1; k < pts.length; k++) auc += ((pts[k]![1] + pts[k - 1]![1]) / 2) * (pts[k]![0] - pts[k - 1]![0]);
  return { unit, time_points, auc, time_weighted_mean: auc / (time_points[time_points.length - 1]! - time_points[0]!) };
}

/** OGTT summaries (not indices): trapezoid AUC over all supplied points, canonical units. */
export function summarize(inputs: Inputs): { glucose: SeriesSummary; insulin: SeriesSummary } {
  return {
    glucose: summarizeSeries(inputs.glucose, 'mmol/L*min', 'glucose'),
    insulin: summarizeSeries(inputs.insulin, 'pmol/L*min', 'insulin'),
  };
}

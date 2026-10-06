// Hand-written, standalone SVG plots (no libraries, no external resources). Every builder returns a complete
// SVG document string with xmlns, an explicit white background and a font-family fallback, so the same string
// is shown on the page and offered as a download. No <style> or style="" (strict CSP): presentation attributes only.
import { quantile7 } from '@isat/core';
import { esc } from './format';

/** Okabe-Ito colour-blind-safe palette. */
export const OKABE_ITO = {
  black: '#000000', orange: '#E69F00', skyBlue: '#56B4E9', green: '#009E73', yellow: '#F0E442',
  blue: '#0072B2', vermillion: '#D55E00', purple: '#CC79A7',
} as const;

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const INK = '#1a1a1a', MUTED = '#595959', GRID = '#d9d9d9';

export function svgDoc(w: number, h: number, inner: string, label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}" role="img" aria-label="${esc(label)}">`
    + `<title>${esc(label)}</title><rect width="${w}" height="${h}" fill="#ffffff"/>${inner}</svg>`;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const fmtTick = (v: number) => String(Number(v.toPrecision(6)));
const num = (v: number) => v.toLocaleString('en-GB');

/** Round-number tick positions covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, target = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / Math.max(1, target);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step - 1e-9) * step; t <= hi + step * 1e-9; t += step) out.push(Number(t.toPrecision(12)));
  return out;
}

const lin = (d0: number, d1: number, r0: number, r1: number) => (v: number) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);

// ---------- histogram ----------
export interface Hist { lo: number; hi: number; bins: number; counts: number[]; n: number; median: number; q1: number; q3: number }

/** Freedman-Diaconis bins (Sturges when IQR = 0), clamped to 10-60. Non-finite values are ignored; null if none. */
export function histogram(values: ArrayLike<number>): Hist | null {
  const v = new Float64Array(values.length);
  let n = 0;
  for (let i = 0; i < values.length; i++) { const x = values[i]!; if (Number.isFinite(x)) v[n++] = x; }
  if (n === 0) return null;
  const s = v.subarray(0, n).sort();
  const min = s[0]!, max = s[n - 1]!, q1 = quantile7(s, 0.25), q3 = quantile7(s, 0.75), median = quantile7(s, 0.5);
  const iqr = q3 - q1;
  const fd = iqr > 0 ? (max - min) / (2 * iqr * Math.pow(n, -1 / 3)) : 0;
  const bins = Math.max(10, Math.min(60, Math.ceil(iqr > 0 && max > min ? fd : Math.log2(n) + 1)));
  const lo = max > min ? min : min - 0.5, hi = max > min ? max : max + 0.5;
  const w = (hi - lo) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (let i = 0; i < n; i++) counts[Math.min(bins - 1, Math.floor((s[i]! - lo) / w))]!++;
  return { lo, hi, bins, counts, n, median, q1, q3 };
}

export interface HistogramOpts {
  values: ArrayLike<number>;
  /** Axis label (index name, with units where known). */
  xLabel: string;
  title: string;
  colour: string;
  /** Rows in the file; missing = total - N. */
  total: number;
  note?: string;
  small?: boolean;
}

export function histogramSvg(o: HistogramOpts): string {
  const h = histogram(o.values);
  const small = !!o.small;
  const W = small ? 240 : 520, H = small ? 176 : 340;
  const m = small ? { l: 38, r: 8, t: 26, b: 34 } : { l: 58, r: 16, t: 34, b: 84 };
  const label = `${o.title}: ${o.xLabel}`;
  const head = `<text x="${m.l}" y="${small ? 14 : 20}" font-size="${small ? 11 : 13.5}" font-weight="600" fill="${INK}">${esc(small ? o.xLabel : o.title)}</text>`;
  if (!h) return svgDoc(W, H, `${head}<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12" fill="${MUTED}">No values to plot</text>`, label);
  const missing = o.total - h.n;
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const maxC = Math.max(...h.counts);
  const yTicks = niceTicks(0, maxC, small ? 3 : 5);
  const yMax = Math.max(maxC, yTicks[yTicks.length - 1]!);
  const sx = lin(h.lo, h.hi, m.l, m.l + pw), sy = lin(0, yMax, m.t + ph, m.t);
  const fs = small ? 9 : 11;
  let g = head;
  for (const t of yTicks) {
    g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${r2(sy(t))}" y2="${r2(sy(t))}" stroke="${GRID}" stroke-width="1"/>`
      + `<text x="${m.l - 5}" y="${r2(sy(t)) + 3.5}" text-anchor="end" font-size="${fs}" fill="${MUTED}">${fmtTick(t)}</text>`;
  }
  const bw = pw / h.bins;
  h.counts.forEach((c, i) => {
    if (!c) return;
    g += `<rect x="${r2(m.l + i * bw)}" y="${r2(sy(c))}" width="${r2(Math.max(0.5, bw - 1))}" height="${r2(m.t + ph - sy(c))}" fill="${o.colour}"/>`;
  });
  g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="${MUTED}" stroke-width="1"/>`;
  for (const t of niceTicks(h.lo, h.hi, small ? 3 : 6)) {
    if (t < h.lo - 1e-12 || t > h.hi + 1e-12) continue;
    g += `<line x1="${r2(sx(t))}" x2="${r2(sx(t))}" y1="${m.t + ph}" y2="${m.t + ph + 4}" stroke="${MUTED}" stroke-width="1"/>`
      + `<text x="${r2(sx(t))}" y="${m.t + ph + (small ? 14 : 17)}" text-anchor="middle" font-size="${fs}" fill="${MUTED}">${fmtTick(t)}</text>`;
  }
  const mx = r2(sx(h.median));
  g += `<line x1="${mx}" x2="${mx}" y1="${m.t}" y2="${m.t + ph}" stroke="${INK}" stroke-width="1.5" stroke-dasharray="5 3"/>`;
  const right = mx > m.l + pw * 0.65;
  g += `<text x="${right ? mx - 4 : mx + 4}" y="${m.t + 11}" text-anchor="${right ? 'end' : 'start'}" font-size="${fs}" fill="${INK}">median ${esc(String(Number(h.median.toPrecision(4))))}</text>`;
  if (!small) {
    g += `<text x="${m.l + pw / 2}" y="${m.t + ph + 40}" text-anchor="middle" font-size="12.5" fill="${INK}">${esc(o.xLabel)}</text>`
      + `<text transform="translate(14 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" font-size="12.5" fill="${INK}">Count</text>`
      + `<text x="${m.l}" y="${H - 26}" font-size="11.5" fill="${MUTED}">N = ${num(h.n)}; missing = ${num(missing)} (of ${num(o.total)})</text>`
      + (o.note ? `<text x="${m.l}" y="${H - 9}" font-size="11.5" fill="${MUTED}">${esc(o.note)}</text>` : '');
  }
  return svgDoc(W, H, g, `${label}. N = ${h.n}, missing = ${missing}, median ${String(Number(h.median.toPrecision(4)))}`);
}

// ---------- density and sex-split plots ----------
const sig = (v: number, d: number) => String(Number(v.toPrecision(d)));

/** Line style per group: Okabe-Ito colour AND a dash pattern, so groups also differ in greyscale. */
export const GROUP_STYLE = {
  male: { label: 'Men', colour: OKABE_ITO.blue, dash: '', width: 2 },
  female: { label: 'Women', colour: OKABE_ITO.vermillion, dash: '7 4', width: 2 },
  all: { label: 'All', colour: '#666666', dash: '1.5 3.5', width: 1.8 },
} as const;
export type GroupKey = keyof typeof GROUP_STYLE;

export interface Curve {
  label: string; n: number; colour: string; dash: string; width: number;
  /** Grid and density (empty when the group has fewer than 2 values). */
  x: number[]; y: number[];
  bw: number; median: number;
}
interface LegendItem { label: string; colour: string; dash: string; box?: boolean }

function legendSvg(items: LegendItem[], x: number, y: number, fs: number): string {
  let g = '', cx = x;
  const sw = fs > 10 ? 24 : 16;
  for (const it of items) {
    g += it.box
      ? `<rect x="${cx}" y="${y - 8}" width="${sw / 2}" height="9" fill="${it.colour}" fill-opacity="0.5" stroke="${it.colour}" stroke-width="1"${it.dash ? ` stroke-dasharray="${it.dash}"` : ''}/>`
      : `<line x1="${cx}" x2="${cx + sw}" y1="${y - 3}" y2="${y - 3}" stroke="${it.colour}" stroke-width="2"${it.dash ? ` stroke-dasharray="${it.dash}" stroke-linecap="round"` : ''}/>`;
    const tx = cx + (it.box ? sw / 2 : sw) + 5;
    g += `<text x="${tx}" y="${y}" font-size="${fs}" fill="${INK}">${esc(it.label)}</text>`;
    cx = tx + it.label.length * fs * 0.56 + 14;
  }
  return g;
}

const capLines = (lines: string[], x: number, y0: number) =>
  lines.map((s, i) => `<text x="${x}" y="${y0 + i * 15}" font-size="11.5" fill="${MUTED}">${esc(s)}</text>`).join('');

const withN = (c: { label: string; n: number }) => `${c.label} (n = ${num(c.n)})`;

export interface DensityOpts {
  curves: Curve[];
  xLabel: string;
  title: string;
  /** Rows in the file; missing = total - n. */
  total: number;
  /** Non-missing values of the plotted column. */
  n: number;
  /** Rows with a value but no recognised sex (reported when sex curves are drawn). */
  sexMissing?: number;
  note?: string;
  small?: boolean;
}

export function densitySvg(o: DensityOpts): string {
  const small = !!o.small;
  const cs = o.curves.filter((c) => c.x.length > 1);
  const multi = o.curves.length > 1;
  const W = small ? 240 : 520;
  const m = small ? { l: 38, r: 8, t: multi ? 38 : 26 } : { l: 58, r: 16, t: multi ? 56 : 34 };
  const label = `${o.title}: ${o.xLabel}`;
  const head = `<text x="${m.l}" y="${small ? 14 : 20}" font-size="${small ? 11 : 13.5}" font-weight="600" fill="${INK}">${esc(small ? o.xLabel : o.title)}</text>`;
  const caps: string[] = [`N = ${num(o.n)}; missing = ${num(o.total - o.n)} (of ${num(o.total)})`];
  if (cs.length) {
    caps.push(!multi ? `bandwidth (bw.nrd0) = ${sig(cs[0]!.bw, 3)}` : `bandwidth (bw.nrd0): ${cs.map((c) => `${c.label} ${sig(c.bw, 3)}`).join('; ')}`);
    caps.push(!multi ? `median = ${sig(cs[0]!.median, 4)}` : `median: ${cs.map((c) => `${c.label} ${sig(c.median, 4)}`).join('; ')}`);
  }
  if (o.sexMissing) caps.push(`${num(o.sexMissing)} rows with missing sex excluded from the sex curves`);
  if (o.note) caps.push(o.note);
  const ph = small ? 104 : 220;
  const H = small ? 176 : m.t + ph + 62 + caps.length * 15;
  if (!cs.length) return svgDoc(W, H, `${head}<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12" fill="${MUTED}">No values to plot</text>`, label);
  const pw = W - m.l - m.r;
  const x0 = Math.min(...cs.map((c) => c.x[0]!)), x1 = Math.max(...cs.map((c) => c.x[c.x.length - 1]!));
  const maxY = Math.max(...cs.map((c) => Math.max(...c.y)));
  const yTicks = niceTicks(0, maxY, small ? 3 : 5);
  const yMax = Math.max(maxY, yTicks[yTicks.length - 1]!);
  const sx = lin(x0, x1, m.l, m.l + pw), sy = lin(0, yMax, m.t + ph, m.t);
  const fs = small ? 9 : 11, base = m.t + ph;
  let g = head;
  if (multi) g += legendSvg(cs.map((c) => ({ label: small ? c.label : withN(c), colour: c.colour, dash: c.dash })), m.l, small ? 28 : 44, small ? 9 : 11.5);
  for (const t of yTicks) {
    g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${r2(sy(t))}" y2="${r2(sy(t))}" stroke="${GRID}" stroke-width="1"/>`
      + `<text x="${m.l - 5}" y="${r2(sy(t)) + 3.5}" text-anchor="end" font-size="${fs}" fill="${MUTED}">${fmtTick(Number(t.toPrecision(4)))}</text>`;
  }
  g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${base}" y2="${base}" stroke="${MUTED}" stroke-width="1"/>`;
  for (const t of niceTicks(x0, x1, small ? 3 : 6)) {
    if (t < x0 - 1e-12 || t > x1 + 1e-12) continue;
    g += `<line x1="${r2(sx(t))}" x2="${r2(sx(t))}" y1="${base}" y2="${base + 4}" stroke="${MUTED}" stroke-width="1"/>`
      + `<text x="${r2(sx(t))}" y="${base + (small ? 14 : 17)}" text-anchor="middle" font-size="${fs}" fill="${MUTED}">${fmtTick(t)}</text>`;
  }
  for (const c of cs) {
    const d = c.x.map((x, i) => `${i ? 'L' : 'M'}${r2(sx(x))} ${r2(sy(c.y[i]!))}`).join('');
    g += `<path class="dens" data-group="${esc(c.label)}" d="${d}" fill="none" stroke="${c.colour}" stroke-width="${c.width}" stroke-linejoin="round"${c.dash ? ` stroke-dasharray="${c.dash}" stroke-linecap="round"` : ''}/>`;
  }
  for (const c of cs) {
    const mx = r2(sx(c.median));
    g += `<line class="med" x1="${mx}" x2="${mx}" y1="${base}" y2="${base - (small ? 8 : 14)}" stroke="${c.colour}" stroke-width="3"><title>${esc(`${c.label} median ${sig(c.median, 4)}`)}</title></line>`;
  }
  if (!small) {
    g += `<text x="${m.l + pw / 2}" y="${base + 40}" text-anchor="middle" font-size="12.5" fill="${INK}">${esc(o.xLabel)}</text>`
      + `<text transform="translate(14 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" font-size="12.5" fill="${INK}">Density</text>`
      + capLines(caps, m.l, base + 62);
  }
  return svgDoc(W, H, g, `${label}. Density, N = ${o.n}${multi ? `; ${cs.map(withN).join('; ')}` : ''}`);
}

export interface HistGroup { label: string; colour: string; dash: string; values: ArrayLike<number> }
export interface HistGroupsOpts {
  groups: HistGroup[];
  xLabel: string; title: string;
  total: number; n: number; sexMissing?: number; note?: string; small?: boolean;
}

/** Overlaid semi-transparent histograms per group on shared bins (Freedman-Diaconis on the pooled values). */
export function histogramGroupsSvg(o: HistGroupsOpts): string {
  const small = !!o.small;
  const pooled: number[] = [];
  const meds: number[] = [], ns: number[] = [];
  for (const gr of o.groups) {
    const s = Array.from(gr.values).filter(Number.isFinite).sort((a, b) => a - b);
    ns.push(s.length); meds.push(s.length ? quantile7(s, 0.5) : NaN);
    for (const v of s) pooled.push(v);
  }
  const h = histogram(pooled);
  const W = small ? 240 : 520;
  const m = small ? { l: 38, r: 8, t: 38 } : { l: 58, r: 16, t: 56 };
  const label = `${o.title}: ${o.xLabel}`;
  const head = `<text x="${m.l}" y="${small ? 14 : 20}" font-size="${small ? 11 : 13.5}" font-weight="600" fill="${INK}">${esc(small ? o.xLabel : o.title)}</text>`;
  const caps = [`N = ${num(o.n)}; missing = ${num(o.total - o.n)} (of ${num(o.total)})`];
  caps.push(`median: ${o.groups.map((gr, i) => `${gr.label} ${Number.isNaN(meds[i]!) ? '-' : sig(meds[i]!, 4)}`).join('; ')}`);
  if (o.sexMissing) caps.push(`${num(o.sexMissing)} rows with missing sex excluded from the sex histograms`);
  if (o.note) caps.push(o.note);
  const ph = small ? 104 : 220;
  const H = small ? 176 : m.t + ph + 62 + caps.length * 15;
  if (!h) return svgDoc(W, H, `${head}<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12" fill="${MUTED}">No values to plot</text>`, label);
  const pw = W - m.l - m.r, base = m.t + ph, fs = small ? 9 : 11;
  const bw = (h.hi - h.lo) / h.bins;
  const counts = o.groups.map((gr) => {
    const c = new Array<number>(h.bins).fill(0);
    for (const v of Array.from(gr.values)) if (Number.isFinite(v)) c[Math.min(h.bins - 1, Math.floor((v - h.lo) / bw))]!++;
    return c;
  });
  const maxC = Math.max(...counts.map((c) => Math.max(...c)));
  const yTicks = niceTicks(0, maxC, small ? 3 : 5);
  const yMax = Math.max(maxC, yTicks[yTicks.length - 1]!);
  const sx = lin(h.lo, h.hi, m.l, m.l + pw), sy = lin(0, yMax, base, m.t);
  let g = head + legendSvg(o.groups.map((gr, i) => ({ label: small ? gr.label : `${gr.label} (n = ${num(ns[i]!)})`, colour: gr.colour, dash: gr.dash, box: true })), m.l, small ? 28 : 44, small ? 9 : 11.5);
  for (const t of yTicks) {
    g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${r2(sy(t))}" y2="${r2(sy(t))}" stroke="${GRID}" stroke-width="1"/>`
      + `<text x="${m.l - 5}" y="${r2(sy(t)) + 3.5}" text-anchor="end" font-size="${fs}" fill="${MUTED}">${fmtTick(t)}</text>`;
  }
  const px = pw / h.bins;
  o.groups.forEach((gr, gi) => {
    counts[gi]!.forEach((c, i) => {
      if (!c) return;
      g += `<rect class="hbar" data-group="${esc(gr.label)}" x="${r2(m.l + i * px)}" y="${r2(sy(c))}" width="${r2(Math.max(0.5, px - 1))}" height="${r2(base - sy(c))}" fill="${gr.colour}" fill-opacity="0.5" stroke="${gr.colour}" stroke-width="1"${gr.dash ? ` stroke-dasharray="${gr.dash}"` : ''}/>`;
    });
  });
  g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${base}" y2="${base}" stroke="${MUTED}" stroke-width="1"/>`;
  for (const t of niceTicks(h.lo, h.hi, small ? 3 : 6)) {
    if (t < h.lo - 1e-12 || t > h.hi + 1e-12) continue;
    g += `<line x1="${r2(sx(t))}" x2="${r2(sx(t))}" y1="${base}" y2="${base + 4}" stroke="${MUTED}" stroke-width="1"/>`
      + `<text x="${r2(sx(t))}" y="${base + (small ? 14 : 17)}" text-anchor="middle" font-size="${fs}" fill="${MUTED}">${fmtTick(t)}</text>`;
  }
  o.groups.forEach((gr, i) => {
    if (Number.isNaN(meds[i]!)) return;
    const mx = r2(sx(meds[i]!));
    g += `<line class="med" x1="${mx}" x2="${mx}" y1="${base}" y2="${base - (small ? 8 : 14)}" stroke="${gr.colour}" stroke-width="3"><title>${esc(`${gr.label} median ${sig(meds[i]!, 4)}`)}</title></line>`;
  });
  if (!small) {
    g += `<text x="${m.l + pw / 2}" y="${base + 40}" text-anchor="middle" font-size="12.5" fill="${INK}">${esc(o.xLabel)}</text>`
      + `<text transform="translate(14 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" font-size="12.5" fill="${INK}">Count</text>`
      + capLines(caps, m.l, base + 62);
  }
  return svgDoc(W, H, g, `${label}. Histogram by group, N = ${o.n}; ${o.groups.map((gr, i) => `${gr.label} (n = ${ns[i]})`).join('; ')}`);
}

// ---------- heatmap ----------
/** Diverging blue (-1) - white (0) - red (+1) scale (RdBu-like, colour-blind-friendly). */
const STOPS: Array<[number, [number, number, number]]> = [
  [-1, [33, 102, 172]], [-0.5, [103, 169, 207]], [0, [247, 247, 247]], [0.5, [239, 138, 98]], [1, [178, 24, 43]],
];
export function divergingColour(r: number): string {
  const v = Math.max(-1, Math.min(1, r));
  for (let k = 1; k < STOPS.length; k++) {
    const [b, cb] = STOPS[k]!, [a, ca] = STOPS[k - 1]!;
    if (v <= b) {
      const t = (v - a) / (b - a);
      return '#' + [0, 1, 2].map((c) => Math.round(ca[c]! + t * (cb[c]! - ca[c]!)).toString(16).padStart(2, '0')).join('');
    }
  }
  return '#b2182b';
}

export interface HeatmapOpts {
  labels: string[];
  /** k x k row-major; NaN = not available. */
  rho: ArrayLike<number>;
  n: ArrayLike<number>;
  title: string;
  subtitle?: string;
  /** Cell size in px (default 17). */
  cell?: number;
  /** Row labels on the left (default true); column labels are always drawn so side-by-side maps stay aligned. */
  rowLabels?: boolean;
  /** The colour scale spans -range..+range (default 1). */
  range?: number;
  /** Legend caption (default "Spearman rho"). */
  statLabel?: string;
  /** Gradient id; give each heatmap on one page its own (default "hg"). */
  idPrefix?: string;
  /** Tooltip text per cell, replacing the default. */
  tip?: (i: number, j: number) => string;
  /** Narrow layout: smaller title, legend caption below the bar. */
  compact?: boolean;
}

const tick = (v: number) => String(Number(v.toFixed(3)));

export function heatmapSvg(o: HeatmapOpts): string {
  const k = o.labels.length, cell = o.cell ?? 17, range = o.range ?? 1, compact = o.compact === true;
  const rowLabels = o.rowLabels !== false;
  const longest = Math.max(1, ...o.labels.map((l) => l.length));
  const lab = Math.min(230, Math.round(longest * 5.6) + 12);
  const L = rowLabels ? lab : 8, T = lab, size = k * cell;
  const lw = compact ? Math.max(120, Math.min(220, size)) : 220;
  const W = Math.max(L + size, L + lw) + 16, H = T + size + (compact ? 92 : 70);
  const gid = o.idPrefix ?? 'hg';
  let g = `<text x="${L}" y="16" font-size="${compact ? 12.5 : 13.5}" font-weight="600" fill="${INK}">${esc(o.title)}</text>${o.subtitle ? `<text x="${L}" y="32" font-size="11.5" fill="${MUTED}">${esc(o.subtitle)}</text>` : ''}`;
  o.labels.forEach((t, i) => {
    if (rowLabels) g += `<text x="${L - 5}" y="${T + i * cell + cell / 2 + 3.5}" text-anchor="end" font-size="10" fill="${INK}">${esc(t)}</text>`;
    g += `<text transform="translate(${L + i * cell + cell / 2 + 3.5} ${T - 5}) rotate(-90)" font-size="10" fill="${INK}">${esc(t)}</text>`;
  });
  const sl = o.statLabel ?? 'Spearman rho';
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const r = o.rho[i * k + j]!, n = o.n[i * k + j]!;
      const na = Number.isNaN(r);
      const tip = o.tip ? o.tip(i, j) : na ? `${o.labels[i]} vs ${o.labels[j]}: not available (n = ${num(n)})` : `${o.labels[i]} vs ${o.labels[j]}: ${sl} = ${r.toFixed(3)}, n = ${num(n)}`;
      g += `<rect class="heat-cell" data-i="${i}" data-j="${j}" tabindex="0" role="button" x="${L + j * cell}" y="${T + i * cell}" width="${cell}" height="${cell}" fill="${na ? '#e3e3e3' : divergingColour(r / range)}" stroke="#ffffff" stroke-width="1"><title>${esc(tip)}</title></rect>`;
    }
  }
  const ly = T + size + 26;
  g += `<defs><linearGradient id="${gid}" x1="0" x2="1" y1="0" y2="0">${STOPS.map(([v, c]) => `<stop offset="${(v + 1) / 2}" stop-color="rgb(${c.join(',')})"/>`).join('')}</linearGradient></defs>`
    + `<rect x="${L}" y="${ly}" width="${lw}" height="12" fill="url(#${gid})" stroke="${MUTED}" stroke-width="0.5"/>`;
  for (const v of [-1, -0.5, 0, 0.5, 1]) {
    g += `<text x="${L + ((v + 1) / 2) * lw}" y="${ly + 25}" text-anchor="middle" font-size="10" fill="${MUTED}">${range === 1 ? v : tick(v * range)}</text>`;
  }
  if (compact) {
    g += `<text x="${L}" y="${ly + 44}" font-size="10.5" fill="${INK}">${esc(sl)}</text>`
      + `<rect x="${L + lw - 92}" y="${ly + 34}" width="12" height="12" fill="#e3e3e3"/><text x="${L + lw - 76}" y="${ly + 44}" font-size="10.5" fill="${INK}">not available</text>`;
  } else {
    g += `<text x="${L + lw + 10}" y="${ly + 10}" font-size="10.5" fill="${INK}">${esc(sl)}</text>`
      + `<rect x="${L + lw + 100}" y="${ly}" width="12" height="12" fill="#e3e3e3"/><text x="${L + lw + 116}" y="${ly + 10}" font-size="10.5" fill="${INK}">not available</text>`;
  }
  return svgDoc(W, H, g, o.title);
}

// ---------- scatter ----------
export interface ScatterOpts {
  x: ArrayLike<number>; y: ArrayLike<number>;
  xLabel: string; yLabel: string;
  rho: number | null; n: number;
  /** Correlation shown in the title (default Spearman). */
  method?: 'spearman' | 'pearson';
  maxPoints?: number;
}

/** Deterministic, evenly spaced subsample of the pairs (every point kept when there are few enough). */
export function samplePairs(x: ArrayLike<number>, y: ArrayLike<number>, max: number): { px: number[]; py: number[]; total: number } {
  const ix: number[] = [];
  for (let i = 0; i < x.length; i++) if (Number.isFinite(x[i]!) && Number.isFinite(y[i]!)) ix.push(i);
  const total = ix.length;
  const pick = total <= max ? ix : Array.from({ length: max }, (_, k) => ix[Math.floor((k * total) / max)]!);
  return { px: pick.map((i) => x[i]!), py: pick.map((i) => y[i]!), total };
}

export function scatterSvg(o: ScatterOpts): string {
  const max = o.maxPoints ?? 20000;
  const { px, py, total } = samplePairs(o.x, o.y, max);
  const W = 640, H = 520, m = { l: 66, r: 16, t: 58, b: 84 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const stats = `${o.method === 'pearson' ? 'Pearson r' : 'Spearman rho'} = ${o.rho === null ? 'not available' : o.rho.toFixed(3)}, n = ${num(o.n)}`;
  const title = `${o.yLabel} vs ${o.xLabel}: ${stats}`;
  let g = `<text x="16" y="20" font-size="12.5" font-weight="600" fill="${INK}">${esc(`${o.yLabel} vs ${o.xLabel}`)}</text><text x="16" y="38" font-size="12.5" font-weight="600" fill="${INK}">${esc(stats)}</text>`;
  if (!px.length) return svgDoc(W, H, g + `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12" fill="${MUTED}">No complete pairs</text>`, title);
  const ext = (a: number[]) => { let lo = Infinity, hi = -Infinity; for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; } if (hi === lo) { lo -= 0.5; hi += 0.5; } const p = (hi - lo) * 0.03; return [lo - p, hi + p] as const; };
  const [x0, x1] = ext(px), [y0, y1] = ext(py);
  const sx = lin(x0, x1, m.l, m.l + pw), sy = lin(y0, y1, m.t + ph, m.t);
  for (const t of niceTicks(y0, y1, 6)) {
    if (t < y0 || t > y1) continue;
    g += `<line x1="${m.l}" x2="${m.l + pw}" y1="${r2(sy(t))}" y2="${r2(sy(t))}" stroke="${GRID}" stroke-width="1"/><text x="${m.l - 5}" y="${r2(sy(t)) + 3.5}" text-anchor="end" font-size="11" fill="${MUTED}">${fmtTick(t)}</text>`;
  }
  for (const t of niceTicks(x0, x1, 6)) {
    if (t < x0 || t > x1) continue;
    g += `<line x1="${r2(sx(t))}" x2="${r2(sx(t))}" y1="${m.t}" y2="${m.t + ph}" stroke="${GRID}" stroke-width="1"/><text x="${r2(sx(t))}" y="${m.t + ph + 16}" text-anchor="middle" font-size="11" fill="${MUTED}">${fmtTick(t)}</text>`;
  }
  g += `<rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="none" stroke="${MUTED}" stroke-width="1"/>`;
  let pts = '';
  for (let i = 0; i < px.length; i++) pts += `<circle cx="${r2(sx(px[i]!))}" cy="${r2(sy(py[i]!))}" r="2.2"/>`;
  g += `<g fill="${OKABE_ITO.blue}" fill-opacity="0.3">${pts}</g>`
    + `<text x="${m.l + pw / 2}" y="${m.t + ph + 38}" text-anchor="middle" font-size="12.5" fill="${INK}">${esc(o.xLabel)}</text>`
    + `<text transform="translate(16 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" font-size="12.5" fill="${INK}">${esc(o.yLabel)}</text>`;
  const sampled = total > px.length;
  g += `<text x="${m.l}" y="${H - 22}" font-size="11.5" fill="${MUTED}">${sampled ? `Showing ${num(px.length)} of ${num(total)} pairs (evenly spaced sample); ${o.method === 'pearson' ? 'r' : 'rho'} uses all pairs.` : `All ${num(total)} pairs shown.`}</text>`;
  return svgDoc(W, H, g, title);
}

/** Download helper text for sampled scatter plots (also shown on the page). */
export const sampledNote = (shown: number, total: number) =>
  total > shown ? `Showing ${num(shown)} of ${num(total)} pairs (evenly spaced sample); rho uses all pairs.` : '';

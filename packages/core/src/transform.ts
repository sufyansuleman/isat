// Descriptive statistics and distribution transforms for batch analysis.
// Missing values are null / undefined / NaN / non-finite on input and NaN on output.

export type TransformKind = 'none' | 'log' | 'z' | 'rint';
export type Num = number | null | undefined;
/** Blom plotting-position offset used by the rank-based inverse normal transform. */
export const BLOM_OFFSET = 0.375;

const ok = (v: Num): v is number => typeof v === 'number' && Number.isFinite(v);

/** Finite values of `values`, compacted. */
function present(values: ArrayLike<Num>): Float64Array {
  const out = new Float64Array(values.length);
  let n = 0;
  for (let i = 0; i < values.length; i++) { const v = values[i]; if (ok(v)) out[n++] = v; }
  return out.subarray(0, n);
}

/** Smallest input size for which the radix sort beats the comparison sort (its digit tables cost 4 x 65,536 counters). */
const RADIX_MIN = 20000;

/**
 * Average ranks for large inputs: LSD radix sort of the IEEE bit patterns (4 x 16 bits), carrying the row index.
 * Equal doubles (and -0 / +0) get equal keys, so ties share the mean rank exactly as in the comparison version.
 */
function rankAvgRadix(values: ArrayLike<Num>, out: Float64Array): void {
  const total = values.length;
  let m = 0;
  for (let i = 0; i < total; i++) if (ok(values[i])) m++;
  const f64 = new Float64Array(1);
  const u32 = new Uint32Array(f64.buffer);
  let lo = new Uint32Array(m), hi = new Uint32Array(m), idx = new Uint32Array(m);
  let lo2 = new Uint32Array(m), hi2 = new Uint32Array(m), idx2 = new Uint32Array(m);
  let k = 0;
  for (let i = 0; i < total; i++) {
    const v = values[i];
    if (!ok(v)) continue;
    f64[0] = v === 0 ? 0 : v; // -0 and +0 are equal
    let l = u32[0]!, h = u32[1]!;
    if (h >>> 31) { l = ~l >>> 0; h = ~h >>> 0; } else h = (h | 0x80000000) >>> 0;
    lo[k] = l; hi[k] = h; idx[k] = i; k++;
  }
  const count = new Uint32Array(65536);
  for (let pass = 0; pass < 4; pass++) {
    const src = pass < 2 ? lo : hi;
    const shift = (pass & 1) * 16;
    count.fill(0);
    for (let i = 0; i < m; i++) count[(src[i]! >>> shift) & 0xffff]!++;
    if (count[(src[0]! >>> shift) & 0xffff] === m) continue; // every key has this digit: nothing to move
    let sum = 0;
    for (let d = 0; d < 65536; d++) { const c = count[d]!; count[d] = sum; sum += c; }
    for (let i = 0; i < m; i++) {
      const p = count[(src[i]! >>> shift) & 0xffff]!++;
      lo2[p] = lo[i]!; hi2[p] = hi[i]!; idx2[p] = idx[i]!;
    }
    [lo, lo2] = [lo2, lo]; [hi, hi2] = [hi2, hi]; [idx, idx2] = [idx2, idx];
  }
  for (let i = 0; i < m;) {
    let j = i + 1;
    while (j < m && lo[j] === lo[i] && hi[j] === hi[i]) j++;
    const r = (i + 1 + j) / 2; // ranks i+1 .. j
    for (let q = i; q < j; q++) out[idx[q]!] = r;
    i = j;
  }
}

/** Average ranks (ties share the mean rank, 1-based). Missing stays NaN. */
export function rankAvg(values: ArrayLike<Num>): Float64Array {
  const out = new Float64Array(values.length).fill(NaN);
  if (values.length >= RADIX_MIN) { rankAvgRadix(values, out); return out; }
  const sorted = present(values).sort(); // fresh array: sorted in place
  const n = sorted.length;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!ok(v)) continue;
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi) >>> 1; if (sorted[m]! < v) lo = m + 1; else hi = m; }
    const first = lo;
    hi = n;
    while (lo < hi) { const m = (lo + hi) >>> 1; if (sorted[m]! <= v) lo = m + 1; else hi = m; }
    out[i] = (first + 1 + lo) / 2; // ranks first+1 .. lo
  }
  return out;
}

// ---------- inverse normal CDF ----------
const A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
const B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
const C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
const D = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
const P_LOW = 0.02425;
const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** Upper tail Q(t) = 1 - Phi(t) for t >= 0: power series for t < 3, continued fraction beyond. */
function upperTail(t: number): number {
  const phi = Math.exp(-0.5 * t * t) / SQRT_2PI;
  if (t < 3) {
    let term = t, sum = t;
    for (let k = 1; k < 1000 && Math.abs(term) > 1e-18 * Math.abs(sum); k++) { term *= (t * t) / (2 * k + 1); sum += term; }
    return 0.5 - phi * sum;
  }
  let f = t;
  for (let k = 300; k >= 1; k--) f = t + k / f;
  return phi / f;
}

/** Inverse standard normal CDF: Acklam's rational approximation plus one Halley refinement step (error < 1e-9). */
export function qnorm(p: number): number {
  if (Number.isNaN(p) || p < 0 || p > 1) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  let x: number;
  if (p < P_LOW) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((C[0]! * q + C[1]!) * q + C[2]!) * q + C[3]!) * q + C[4]!) * q + C[5]!) / ((((D[0]! * q + D[1]!) * q + D[2]!) * q + D[3]!) * q + 1);
  } else if (p <= 1 - P_LOW) {
    const q = p - 0.5, r = q * q;
    x = (((((A[0]! * r + A[1]!) * r + A[2]!) * r + A[3]!) * r + A[4]!) * r + A[5]!) * q / (((((B[0]! * r + B[1]!) * r + B[2]!) * r + B[3]!) * r + B[4]!) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((C[0]! * q + C[1]!) * q + C[2]!) * q + C[3]!) * q + C[4]!) * q + C[5]!) / ((((D[0]! * q + D[1]!) * q + D[2]!) * q + D[3]!) * q + 1);
  }
  // Halley step on e = Phi(x) - p, evaluated from the tail nearest to p for accuracy.
  const e = x <= 0 ? upperTail(-x) - p : (1 - p) - upperTail(x);
  const u = e * SQRT_2PI * Math.exp(0.5 * x * x);
  return x - u / (1 + x * u / 2);
}

// ---------- transforms ----------
export interface TransformOptions {
  /** Group label per row (e.g. sex). Transform within each group; a missing label makes the row missing. */
  groups?: ArrayLike<string | null | undefined>;
}
export interface TransformResult {
  values: Float64Array;
  /** Values <= 0 set to missing (log only). */
  nonPositive: number;
  /** Why values were set to missing wholesale (z with n < 2 or SD = 0). */
  reasons: string[];
  /** Per group: number of non-missing input values (empty when no groups). */
  groupN: Record<string, number>;
  /** Rows with a missing group label that were set to missing (when groups given). */
  noGroup: number;
}

/** Transform of one block of finite-or-NaN values (no grouping). */
function applyKind(v: Float64Array, kind: TransformKind, label: string, res: TransformResult): Float64Array {
  const out = new Float64Array(v.length).fill(NaN);
  if (kind === 'none') { out.set(v); return out; }
  if (kind === 'log') {
    for (let i = 0; i < v.length; i++) {
      const x = v[i]!;
      if (Number.isNaN(x)) continue;
      if (x > 0) out[i] = Math.log(x); else res.nonPositive++;
    }
    return out;
  }
  let n = 0;
  for (let i = 0; i < v.length; i++) if (ok(v[i])) n++;
  const tag = label ? `${label}: ` : '';
  if (kind === 'z') {
    if (n < 2) { res.reasons.push(`${tag}fewer than 2 non-missing values`); return out; }
    let s = 0;
    for (let i = 0; i < v.length; i++) if (!Number.isNaN(v[i]!)) s += v[i]!;
    const mean = s / n;
    let ss = 0;
    for (let i = 0; i < v.length; i++) if (!Number.isNaN(v[i]!)) ss += (v[i]! - mean) ** 2;
    const sd = Math.sqrt(ss / (n - 1));
    if (!(sd > 0)) { res.reasons.push(`${tag}SD is 0`); return out; }
    for (let i = 0; i < v.length; i++) if (!Number.isNaN(v[i]!)) out[i] = (v[i]! - mean) / sd;
    return out;
  }
  const r = rankAvg(v);
  const memo = rintMemo(n);
  const den = n + 1 - 2 * BLOM_OFFSET;
  for (let i = 0; i < v.length; i++) {
    const ri = r[i]!;
    if (Number.isNaN(ri)) continue;
    if (memo) {
      // The Blom value depends only on (rank, n); ranks are whole or half numbers, so 2 * rank is the table index.
      const k = ri * 2;
      let q = memo[k]!;
      if (Number.isNaN(q)) memo[k] = q = qnorm((ri - BLOM_OFFSET) / den);
      out[i] = q;
    } else out[i] = qnorm((ri - BLOM_OFFSET) / den);
  }
  return out;
}

/** Per-n tables of Blom values (NaN = not computed yet), kept for the last few group sizes: columns with the same n reuse them. */
const MEMO_ENTRIES = 4;
const MEMO_MAX_N = 4_000_000;
const rintTables = new Map<number, Float64Array>();
function rintMemo(n: number): Float64Array | undefined {
  if (n < 1000 || n > MEMO_MAX_N) return undefined;
  let t = rintTables.get(n);
  if (!t) {
    if (rintTables.size >= MEMO_ENTRIES) rintTables.delete(rintTables.keys().next().value as number);
    t = new Float64Array(2 * n + 2).fill(NaN);
    rintTables.set(n, t);
  }
  return t;
}

/** none | natural log | z-score (sample SD) | rank-based inverse normal (Blom), optionally within groups. */
export function transform(values: ArrayLike<Num>, kind: TransformKind, opts: TransformOptions = {}): TransformResult {
  const res: TransformResult = { values: new Float64Array(0), nonPositive: 0, reasons: [], groupN: {}, noGroup: 0 };
  const base = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) { const x = values[i]; base[i] = ok(x) ? x : NaN; }
  const g = opts.groups;
  if (!g) { res.values = applyKind(base, kind, '', res); return res; }
  const out = new Float64Array(values.length).fill(NaN);
  // Groups in order of first appearance (this order shows in groupN and reasons); row indices per group in typed arrays.
  const labIndex = new Map<string, number>();
  const labels: string[] = [];
  const counts: number[] = [];
  const gid = new Int32Array(values.length).fill(-1);
  for (let i = 0; i < values.length; i++) {
    const lab = g[i];
    if (lab === null || lab === undefined || lab === '') { if (!Number.isNaN(base[i]!)) res.noGroup++; continue; }
    let k = labIndex.get(lab);
    if (k === undefined) { k = labels.length; labIndex.set(lab, k); labels.push(lab); counts.push(0); }
    gid[i] = k; counts[k]!++;
  }
  const idxs = counts.map((c) => new Int32Array(c));
  const fill = new Int32Array(labels.length);
  for (let i = 0; i < values.length; i++) { const k = gid[i]!; if (k >= 0) idxs[k]![fill[k]!++] = i; }
  for (let k = 0; k < labels.length; k++) {
    const lab = labels[k]!, idx = idxs[k]!;
    const sub = new Float64Array(idx.length);
    let np = 0;
    for (let j = 0; j < idx.length; j++) { const x = base[idx[j]!]!; sub[j] = x; if (ok(x)) np++; }
    res.groupN[lab] = np;
    const t = applyKind(sub, kind, lab, res);
    for (let j = 0; j < idx.length; j++) out[idx[j]!] = t[j]!;
  }
  res.values = out;
  return res;
}

// ---------- descriptive statistics ----------
export interface Described {
  n: number; missing: number;
  mean: number | null; sd: number | null; median: number | null; q1: number | null; q3: number | null;
  min: number | null; max: number | null; skewness: number | null;
}

/** Type-7 quantile (R default) of an ascending-sorted array. */
export function quantile7(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  const h = (n - 1) * p, lo = Math.floor(h);
  const a = sorted[lo]!;
  return lo + 1 < n ? a + (h - lo) * (sorted[lo + 1]! - a) : a;
}

/** Summary statistics; skewness is the adjusted Fisher-Pearson G1 (e1071 type 2 / SAS). Undefined statistics are null. */
export function describe(values: ArrayLike<Num>): Described {
  const v = Float64Array.from(present(values)).sort();
  const n = v.length;
  const out: Described = { n, missing: values.length - n, mean: null, sd: null, median: null, q1: null, q3: null, min: null, max: null, skewness: null };
  if (n === 0) return out;
  let s = 0;
  for (let i = 0; i < n; i++) s += v[i]!;
  const mean = s / n;
  let m2 = 0, m3 = 0;
  for (let i = 0; i < n; i++) { const d = v[i]! - mean; m2 += d * d; m3 += d * d * d; }
  out.mean = mean; out.min = v[0]!; out.max = v[n - 1]!;
  out.median = quantile7(v, 0.5); out.q1 = quantile7(v, 0.25); out.q3 = quantile7(v, 0.75);
  if (n >= 2) out.sd = Math.sqrt(m2 / (n - 1));
  if (n >= 3 && m2 > 0) {
    const g1 = (m3 / n) / Math.pow(m2 / n, 1.5);
    out.skewness = g1 * Math.sqrt(n * (n - 1)) / (n - 2);
  }
  return out;
}

// ---------- Spearman and Pearson ----------
function pearsonArr(a: Float64Array, b: Float64Array): number {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]!; mb += b[i]!; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const da = a[i]! - ma, db = b[i]! - mb; sab += da * db; saa += da * da; sbb += db * db; }
  if (!(saa > 0) || !(sbb > 0)) return NaN;
  return Math.max(-1, Math.min(1, sab / Math.sqrt(saa * sbb)));
}

/** Pairwise-complete Spearman rho (Pearson on average ranks). Null if n < 3 or either variable is constant. */
export function spearman(x: ArrayLike<Num>, y: ArrayLike<Num>): { rho: number; n: number } | null {
  const len = Math.min(x.length, y.length);
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < len; i++) if (ok(x[i]) && ok(y[i])) { xs.push(x[i] as number); ys.push(y[i] as number); }
  if (xs.length < 3) return null;
  const rho = pearsonArr(rankAvg(xs), rankAvg(ys));
  return Number.isNaN(rho) ? null : { rho, n: xs.length };
}

/** Pairwise-complete Pearson correlation. Null if n < 3 or either variable is constant on the complete pairs. */
export function pearson(x: ArrayLike<Num>, y: ArrayLike<Num>): { r: number; n: number } | null {
  const len = Math.min(x.length, y.length);
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < len; i++) if (ok(x[i]) && ok(y[i])) { xs.push(x[i] as number); ys.push(y[i] as number); }
  if (xs.length < 3) return null;
  const r = pearsonArr(Float64Array.from(xs), Float64Array.from(ys));
  return Number.isNaN(r) ? null : { r, n: xs.length };
}

export interface SpearmanMatrix { k: number; rho: Float64Array; n: Int32Array }

/** All pairwise Pearson correlations (k x k, row-major; NaN = not available), pairwise complete; same shape as spearmanMatrix. */
export function pearsonMatrix(cols: Float64Array[]): SpearmanMatrix {
  const k = cols.length;
  const rho = new Float64Array(k * k).fill(NaN), nn = new Int32Array(k * k);
  if (k === 0) return { k, rho, n: nn };
  const len = cols[0]!.length;
  for (let i = 0; i < k; i++) {
    const a = cols[i]!;
    for (let j = i; j < k; j++) {
      const b = cols[j]!;
      let n = 0, sa = 0, sb = 0;
      for (let r = 0; r < len; r++) { const u = a[r]!, v = b[r]!; if (u === u && v === v) { n++; sa += u; sb += v; } }
      let val = NaN;
      if (n >= 3) {
        const ma = sa / n, mb = sb / n;
        let sab = 0, saa = 0, sbb = 0;
        for (let r = 0; r < len; r++) { const u = a[r]!, v = b[r]!; if (u === u && v === v) { const da = u - ma, db = v - mb; sab += da * db; saa += da * da; sbb += db * db; } }
        if (saa > 0 && sbb > 0) val = i === j ? 1 : Math.max(-1, Math.min(1, sab / Math.sqrt(saa * sbb)));
      }
      rho[i * k + j] = val; rho[j * k + i] = val; nn[i * k + j] = n; nn[j * k + i] = n;
    }
  }
  return { k, rho, n: nn };
}

/**
 * All pairwise Spearman correlations (k x k, row-major; NaN = not available). Equal to spearman() on every pair,
 * but columns with the same missingness pattern are ranked once.
 */
export function spearmanMatrix(cols: Float64Array[]): SpearmanMatrix {
  const k = cols.length;
  const rho = new Float64Array(k * k).fill(NaN), nn = new Int32Array(k * k);
  if (k === 0) return { k, rho, n: nn };
  const len = cols[0]!.length;
  // Group columns by exact missingness pattern.
  const masks: Uint8Array[] = [], counts: number[] = [], colGroup: number[] = [];
  const byHash = new Map<string, number[]>();
  for (const c of cols) {
    const m = new Uint8Array(len);
    let cnt = 0, h = 2166136261;
    for (let r = 0; r < len; r++) { if (!Number.isNaN(c[r]!)) { m[r] = 1; cnt++; h = Math.imul(h ^ r, 16777619); } }
    const key = `${cnt}:${h >>> 0}`;
    let found = -1;
    for (const g of byHash.get(key) ?? []) {
      const o = masks[g]!;
      let same = true;
      for (let r = 0; r < len; r++) if (o[r] !== m[r]) { same = false; break; }
      if (same) { found = g; break; }
    }
    if (found < 0) { found = masks.length; masks.push(m); counts.push(cnt); byHash.set(key, [...(byHash.get(key) ?? []), found]); }
    colGroup.push(found);
  }
  const compact = (c: Float64Array, m: Uint8Array, cnt: number) => {
    const o = new Float64Array(cnt);
    for (let r = 0, j = 0; r < len; r++) if (m[r]) o[j++] = c[r]!;
    return o;
  };
  const ownRanks = new Map<number, Float64Array>(); // column -> ranks over its own pattern
  const own = (i: number) => {
    let r = ownRanks.get(i);
    if (!r) ownRanks.set(i, r = rankAvg(compact(cols[i]!, masks[colGroup[i]!]!, counts[colGroup[i]!]!)));
    return r;
  };
  const G = masks.length;
  for (let ga = 0; ga < G; ga++) {
    for (let gb = ga; gb < G; gb++) {
      const ma = masks[ga]!, mb = masks[gb]!;
      let inter = ma, cnt = counts[ga]!;
      if (ga !== gb) {
        inter = new Uint8Array(len); cnt = 0;
        for (let r = 0; r < len; r++) if (ma[r] && mb[r]) { inter[r] = 1; cnt++; }
      }
      const useA = cnt === counts[ga]!, useB = cnt === counts[gb]!;
      const rk = new Map<number, Float64Array>();
      const get = (i: number, useOwn: boolean) => {
        if (useOwn) return own(i);
        let r = rk.get(i);
        if (!r) rk.set(i, r = rankAvg(compact(cols[i]!, inter, cnt)));
        return r;
      };
      for (let i = 0; i < k; i++) {
        if (colGroup[i] !== ga) continue;
        for (let j = 0; j < k; j++) {
          if (colGroup[j] !== gb || (ga === gb && j < i)) continue;
          let v = NaN;
          if (cnt >= 3) {
            if (i === j) { const r = get(i, useA); v = Number.isNaN(pearsonArr(r, r)) ? NaN : 1; }
            else v = pearsonArr(get(i, useA), get(j, useB));
          }
          rho[i * k + j] = v; rho[j * k + i] = v; nn[i * k + j] = cnt; nn[j * k + i] = cnt;
        }
      }
    }
  }
  return { k, rho, n: nn };
}

// ---------- kernel density ----------
/** R's bw.nrd0: 0.9 * min(sd, IQR / 1.34) * n^(-1/5), with R's fallbacks (sd, then |x[1]|, then 1) when that minimum is 0. */
export function bwNrd0(values: ArrayLike<Num>): number {
  const x = present(values);
  const n = x.length;
  if (n < 2) return NaN;
  const s = Float64Array.from(x).sort();
  let sum = 0;
  for (let i = 0; i < n; i++) sum += s[i]!;
  const mean = sum / n;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (s[i]! - mean) ** 2;
  const sd = Math.sqrt(ss / (n - 1));
  let lo = Math.min(sd, (quantile7(s, 0.75) - quantile7(s, 0.25)) / 1.34);
  if (!lo) { lo = sd; if (!lo) { lo = Math.abs(x[0]!); if (!lo) lo = 1; } }
  return 0.9 * lo * Math.pow(n, -0.2);
}

export interface KdeOptions {
  /** Bandwidth (default bwNrd0). */
  bw?: number;
  /** Grid points (default 256). */
  n?: number;
  from?: number; to?: number;
  /** Grid extends cut * bw beyond the data range (default 3, as R's density()). */
  cut?: number;
}
export interface Kde { x: number[]; y: number[]; bw: number; n: number }

/** Above this many observations the density is computed from linearly binned data (see kde). */
export const KDE_EXACT_MAX = 20000;

/**
 * Gaussian kernel density on an even grid from min - cut*bw to max + cut*bw (R density() defaults).
 * Exact (sum of dnorm over observations) for up to 20,000 non-missing values. Above that, observations are
 * linearly binned (each value split between its two neighbouring bin centres) onto an even grid of
 * max(2048, 32 * range / bw) points (capped at 65536) and the kernel sum is taken over the bin weights
 * within 9 bandwidths of each grid point (the rest is below 1e-17 of the peak); this approximation stays within 1e-3 relative error of the exact sum on the grid (tested).
 * `n` in the result is the number of non-missing observations.
 */
export function kde(values: ArrayLike<Num>, opts: KdeOptions = {}): Kde {
  const x = present(values);
  const nObs = x.length;
  const bw = opts.bw ?? bwNrd0(x);
  if (nObs < 2 || !(bw > 0)) return { x: [], y: [], bw, n: nObs };
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < nObs; i++) { const v = x[i]!; if (v < mn) mn = v; if (v > mx) mx = v; }
  const cut = opts.cut ?? 3, G = Math.max(2, opts.n ?? 256);
  const from = opts.from ?? mn - cut * bw, to = opts.to ?? mx + cut * bw;
  const gx: number[] = new Array(G), gy: number[] = new Array(G).fill(0);
  const step = (to - from) / (G - 1);
  const norm = 1 / (Math.sqrt(2 * Math.PI) * bw * nObs);
  for (let k = 0; k < G; k++) gx[k] = from + k * step;
  if (nObs <= KDE_EXACT_MAX) {
    for (let k = 0; k < G; k++) {
      let s = 0;
      for (let i = 0; i < nObs; i++) { const u = (gx[k]! - x[i]!) / bw; s += Math.exp(-0.5 * u * u); }
      gy[k] = s * norm;
    }
  } else {
    const B = Math.min(65536, Math.max(2048, Math.ceil(32 * (mx - mn) / bw)));
    const bs = (mx - mn) / (B - 1), w = new Float64Array(B);
    for (let i = 0; i < nObs; i++) {
      const p = (x[i]! - mn) / bs, j = Math.min(B - 2, Math.floor(p)), f = p - j;
      w[j]! += 1 - f; w[j + 1]! += f;
    }
    for (let k = 0; k < G; k++) {
      let s = 0;
      const j0 = Math.max(0, Math.ceil((gx[k]! - 9 * bw - mn) / bs)), j1 = Math.min(B - 1, Math.floor((gx[k]! + 9 * bw - mn) / bs));
      for (let j = j0; j <= j1; j++) {
        const wj = w[j]!;
        if (wj === 0) continue;
        const u = (gx[k]! - (mn + j * bs)) / bw;
        s += wj * Math.exp(-0.5 * u * u);
      }
      gy[k] = s * norm;
    }
  }
  return { x: gx, y: gy, bw, n: nObs };
}

/** Frees the cached RINT tables (long-running callers such as the command-line tool call this when done). */
export function resetTransformCache(): void { rintTables.clear(); }

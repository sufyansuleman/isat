import { describe as suite, it, expect } from 'vitest';
import { BLOM_OFFSET, describe, qnorm, quantile7, rankAvg, spearman, spearmanMatrix, transform } from '../src/index';

const arr = (a: ArrayLike<number>) => Array.from(a);
const nanToNull = (a: ArrayLike<number>) => arr(a).map((v) => (Number.isNaN(v) ? null : v));

suite('rankAvg', () => {
  it('averages ties and keeps missing missing', () => {
    expect(nanToNull(rankAvg([10, 20, 20, null, 5, NaN, 20, undefined]))).toEqual([2, 4, 4, null, 1, null, 4, null]);
  });
  it('handles all-missing and empty input', () => {
    expect(arr(rankAvg([]))).toEqual([]);
    expect(nanToNull(rankAvg([null, NaN]))).toEqual([null, null]);
  });
});

suite('qnorm', () => {
  it('matches reference values to 1e-9', () => {
    expect(Math.abs(qnorm(0.975) - 1.959963984540054)).toBeLessThan(1e-9);
    expect(qnorm(0.5)).toBe(0);
    expect(Math.abs(qnorm(0.001) - -3.090232306167813)).toBeLessThan(1e-9);
  });
  it('is antisymmetric, including in the tails', () => {
    for (const p of [1e-6, 0.001, 0.01, 0.02425, 0.1, 0.3, 0.4999]) {
      expect(Math.abs(qnorm(p) + qnorm(1 - p))).toBeLessThan(1e-9);
    }
  });
  it('is accurate far in the tail', () => { expect(Math.abs(qnorm(1e-10) - -6.361340902404056)).toBeLessThan(1e-9); });
  it('handles the boundaries', () => {
    expect(qnorm(0)).toBe(-Infinity);
    expect(qnorm(1)).toBe(Infinity);
    expect(qnorm(1.5)).toBeNaN();
  });
});

suite('transform', () => {
  const v = [1, 2, 2, 5, null, 10, -3, 0];
  it('none returns the values with missing as NaN', () => {
    expect(nanToNull(transform(v, 'none').values)).toEqual([1, 2, 2, 5, null, 10, -3, 0]);
  });
  it('log counts and blanks values <= 0', () => {
    const t = transform(v, 'log');
    expect(t.nonPositive).toBe(2);
    expect(nanToNull(t.values)).toEqual([0, Math.log(2), Math.log(2), Math.log(5), null, Math.log(10), null, null]);
  });
  it('z uses the sample SD over non-missing values', () => {
    const t = transform([1, 2, 3, 4, null], 'z');
    const sd = Math.sqrt(5 / 3);
    expect(nanToNull(t.values)).toEqual([(1 - 2.5) / sd, (2 - 2.5) / sd, (3 - 2.5) / sd, (4 - 2.5) / sd, null]);
  });
  it('z is all missing with a reason when n < 2 or SD = 0', () => {
    const a = transform([3, null], 'z');
    expect(nanToNull(a.values)).toEqual([null, null]);
    expect(a.reasons.length).toBe(1);
    const b = transform([3, 3, 3], 'z');
    expect(nanToNull(b.values)).toEqual([null, null, null]);
    expect(b.reasons[0]).toContain('SD');
  });
  it('rint is Blom: qnorm((r - 3/8) / (n + 1/4)) with average ranks', () => {
    expect(BLOM_OFFSET).toBe(0.375);
    const t = transform([5, 1, 3, null, 3], 'rint').values;
    const n = 4, ranks = [4, 1, 2.5, NaN, 2.5];
    ranks.forEach((r, i) => { if (!Number.isNaN(r)) expect(t[i]).toBeCloseTo(qnorm((r - 0.375) / (n + 0.25)), 12); });
    expect(t[3]).toBeNaN();
    expect(t[2]).toBe(t[4]);
  });
  it('within groups transforms each group separately and blanks rows with no group', () => {
    const vals = [1, 2, 3, 10, 20, 30, 7];
    const groups = ['male', 'male', 'male', 'female', 'female', 'female', null];
    const t = transform(vals, 'z', { groups });
    expect(t.groupN).toEqual({ male: 3, female: 3 });
    expect(t.noGroup).toBe(1);
    expect(t.values[0]).toBeCloseTo(-1, 12);
    expect(t.values[3]).toBeCloseTo(-1, 12);
    expect(t.values[4]).toBeCloseTo(0, 12);
    expect(t.values[6]).toBeNaN();
  });
  it('within groups: a group with one value is missing with a reason', () => {
    const t = transform([1, 2, 3, 9], 'z', { groups: ['a', 'a', 'a', 'b'] });
    expect(t.values[3]).toBeNaN();
    expect(t.reasons[0]).toContain('b');
  });
});

suite('describe', () => {
  it('matches R for a small vector', () => {
    const d = describe([2, 4, 4, 4, 5, 5, 7, 9, null]);
    expect(d.n).toBe(8);
    expect(d.missing).toBe(1);
    expect(d.mean).toBe(5);
    expect(d.sd).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(d.median).toBe(4.5);
    expect(d.q1).toBe(4);
    expect(d.q3).toBe(5.5);
    expect(d.min).toBe(2);
    expect(d.max).toBe(9);
    // e1071::skewness(c(2,4,4,4,5,5,7,9), type = 2)
    expect(d.skewness).toBeCloseTo(0.8184875533567997, 9);
  });
  it('quantile7 interpolates', () => {
    expect(quantile7([1, 2, 3, 4], 0.25)).toBe(1.75);
  });
  it('returns null where undefined', () => {
    const d = describe([null, 4]);
    expect(d.n).toBe(1);
    expect(d.sd).toBeNull();
    expect(d.skewness).toBeNull();
    expect(describe([]).mean).toBeNull();
  });
});

suite('spearman', () => {
  it('is pairwise complete', () => {
    const r = spearman([1, 2, 3, 4, null, 6], [2, 1, 4, 3, 9, null]);
    expect(r!.n).toBe(4);
    expect(r!.rho).toBeCloseTo(0.6, 12);
  });
  it('is null for n < 3 or zero variance', () => {
    expect(spearman([1, 2, null], [1, 2, 3])).toBeNull();
    expect(spearman([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull();
  });
  it('matrix equals pairwise spearman with differing missingness', () => {
    let s = 12345;
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const n = 200;
    const cols = [0, 1, 2, 3, 4].map((c) => Float64Array.from({ length: n }, (_, i) => {
      const missing = (c === 2 && i % 7 === 0) || (c === 3 && i % 5 === 0) || (c === 4 && i < 20);
      return missing ? NaN : Math.round(rnd() * 30) + (c === 1 ? i / 10 : 0);
    }));
    const m = spearmanMatrix(cols);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      const ref = spearman(cols[i]!, cols[j]!);
      expect(m.n[i * 5 + j]).toBe(ref!.n);
      expect(m.rho[i * 5 + j]).toBeCloseTo(ref!.rho, 12);
    }
  });
});

import { bwNrd0, kde } from '../src/index';

suite('bwNrd0 and kde', () => {
  const exact = (x: number[], g: number[], bw: number) => g.map((t) => x.reduce((s, v) => s + Math.exp(-0.5 * ((t - v) / bw) ** 2), 0) / (Math.sqrt(2 * Math.PI) * bw * x.length));
  it('bwNrd0 follows R, including fallbacks and missing values', () => {
    const x = [1, 2, 4, 7, 11, 16, 22];
    // R: bw.nrd0(c(1,2,4,7,11,16,22)) = 0.9 * min(sd, IQR/1.34) * 7^-0.2
    const sd = Math.sqrt(x.reduce((s, v) => s + (v - 9) ** 2, 0) / 6);
    expect(Math.abs(bwNrd0(x) - 0.9 * Math.min(sd, 10.5 / 1.34) * Math.pow(7, -0.2))).toBeLessThan(1e-12);
    expect(bwNrd0([...x, null, NaN])).toBeCloseTo(bwNrd0(x), 12);
    expect(bwNrd0([5, 5, 5, 5, 9])).toBeGreaterThan(0); // IQR = 0 -> sd
    expect(bwNrd0([3, 3, 3])).toBeCloseTo(0.9 * 3 * Math.pow(3, -0.2), 12); // sd = 0 -> |x[1]|
    expect(bwNrd0([0, 0, 0])).toBeCloseTo(0.9 * Math.pow(3, -0.2), 12); // -> 1
    expect(bwNrd0([1])).toBeNaN();
  });
  it('kde exact path equals the dnorm sum on its grid and integrates to ~1', () => {
    let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const x = Array.from({ length: 300 }, () => Math.exp(rnd() * 2));
    const d = kde([...x, null], {});
    expect(d.x.length).toBe(256); expect(d.n).toBe(300);
    const e = exact(x, d.x, d.bw);
    for (let k = 0; k < 256; k++) expect(Math.abs(d.y[k]! - e[k]!)).toBeLessThan(1e-12);
    const step = d.x[1]! - d.x[0]!;
    expect(Math.abs(d.y.reduce((a, b) => a + b, 0) * step - 1)).toBeLessThan(0.01);
    expect(d.x[0]).toBeCloseTo(Math.min(...x) - 3 * d.bw, 12);
  });
  it('kde returns an empty curve for fewer than 2 values', () => { expect(kde([1, null]).x).toEqual([]); });
  it('binned path (n > 20000) is within 1e-3 relative error of the exact sum', () => {
    let s = 11; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const x = Array.from({ length: 30000 }, () => Math.exp(0.6 * gauss() + 2));
    const d = kde(x);
    const e = exact(x, d.x, d.bw);
    const peak = Math.max(...e);
    let worst = 0;
    for (let k = 0; k < 256; k++) if (e[k]! > 1e-3 * peak) worst = Math.max(worst, Math.abs(d.y[k]! - e[k]!) / e[k]!);
    expect(worst).toBeLessThan(1e-3);
  });
});

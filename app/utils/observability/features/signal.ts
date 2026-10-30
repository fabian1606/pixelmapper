/**
 * Signal preparation and small numeric helpers shared by the feature
 * extractors (ADR 0002 §6.3).
 *
 * A `Signal` is one multivariate time series (a sample, a merged fixture
 * or a single component): per-component values with NaN replaced by the
 * component mean, centered copies, and an "intensity" series used for
 * range, events and peak times.
 */
import type { Signature } from '~/utils/engine/types';

// ── Constants ───────────────────────────────────

/** Standard deviation below which a component counts as constant. */
export const CONSTANT_SD = 1e-3;

// ── Signal ──────────────────────────────────────

/** One prepared multivariate time series. */
export interface Signal {
  /** Component series (NaN replaced by the component's finite mean). */
  comps: Float64Array[];
  /** Component series minus their means. */
  centered: Float64Array[];
  means: number[];
  sds: number[];
  /** Sum over components and frames of the squared centered values. */
  energy: number;
  /** All components have `sd < CONSTANT_SD`. */
  constant: boolean;
  /** Intensity series (scalar value, rgb max, panTilt mean). */
  intensity: Float64Array;
  /** At least one value was NaN. */
  hasNaN: boolean;
  /** Every value was NaN. */
  allNaN: boolean;
  frames: number;
}

/** Component names of a signature (`components` keys of the JSON). */
export function componentNames(signature: Signature): string[] {
  if (signature === 'rgb') return ['r', 'g', 'b'];
  if (signature === 'panTilt') return ['pan', 'tilt'];
  return ['value'];
}

/** Intensity series of component series: rgb max, otherwise the component mean. */
export function intensitySeries(comps: Float64Array[], signature: Signature): Float64Array {
  const frames = comps[0]?.length ?? 0;
  const out = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let acc = 0;
    if (signature === 'rgb') {
      // HSV value: brightest channel.
      for (const c of comps) acc = Math.max(acc, c[f]!);
      out[f] = acc;
    } else {
      for (const c of comps) acc += c[f]!;
      out[f] = acc / Math.max(1, comps.length);
    }
  }
  return out;
}

/** Splits frame-major sample values into component series (NaN kept). */
export function splitComponents(values: Float32Array, arity: number, frames: number): Float64Array[] {
  const comps: Float64Array[] = [];
  for (let c = 0; c < arity; c++) {
    const s = new Float64Array(frames);
    for (let f = 0; f < frames; f++) {
      const v = values[f * arity + c];
      s[f] = v === undefined ? NaN : v;
    }
    comps.push(s);
  }
  return comps;
}

/**
 * Builds a signal from raw component series (may contain NaN). Missing
 * values are replaced by the finite mean of their component (0 if none).
 */
export function makeSignal(raw: Float64Array[], intensityOf: (comps: Float64Array[]) => Float64Array): Signal {
  const frames = raw[0]?.length ?? 0;
  let nanCount = 0;
  const comps: Float64Array[] = [];
  const centered: Float64Array[] = [];
  const means: number[] = [];
  const sds: number[] = [];
  let energy = 0;
  for (const r of raw) {
    // Finite mean of the component.
    let sum = 0;
    let n = 0;
    for (let f = 0; f < frames; f++) {
      const v = r[f]!;
      if (Number.isFinite(v)) {
        sum += v;
        n++;
      }
    }
    nanCount += frames - n;
    const m = n > 0 ? sum / n : 0;
    const c = new Float64Array(frames);
    const z = new Float64Array(frames);
    let sq = 0;
    for (let f = 0; f < frames; f++) {
      const v = r[f]!;
      c[f] = Number.isFinite(v) ? v : m;
      z[f] = c[f]! - m;
      sq += z[f]! * z[f]!;
    }
    comps.push(c);
    centered.push(z);
    means.push(m);
    sds.push(frames > 0 ? Math.sqrt(sq / frames) : 0);
    energy += sq;
  }
  return {
    comps,
    centered,
    means,
    sds,
    energy,
    constant: sds.every(s => s < CONSTANT_SD),
    intensity: intensityOf(comps),
    hasNaN: nanCount > 0,
    allNaN: frames * raw.length > 0 && nanCount === frames * raw.length,
    frames,
  };
}

/** Signal of a single component of another signal. */
export function componentSignal(sig: Signal, c: number): Signal {
  const comp = sig.comps[c] ?? new Float64Array(sig.frames);
  return makeSignal([comp], comps => comps[0]!);
}

/** Mean signal (per frame and component) of several signals of equal shape. */
export function meanComponents(signals: Signal[]): Float64Array[] {
  const first = signals[0];
  if (!first) return [];
  const out = first.comps.map(() => new Float64Array(first.frames));
  for (const s of signals) {
    s.comps.forEach((c, ci) => {
      const o = out[ci]!;
      for (let f = 0; f < c.length; f++) o[f]! += c[f]!;
    });
  }
  for (const o of out) for (let f = 0; f < o.length; f++) o[f] = o[f]! / signals.length;
  return out;
}

// ── Issues ──────────────────────────────────────

/** Issue codes of one signal: nan, constant, stuck-0, stuck-1, clamped. */
export function signalIssues(sig: Signal): string[] {
  const issues: string[] = [];
  if (sig.hasNaN) issues.push('nan');
  if (sig.allNaN) return issues;
  if (sig.constant) {
    issues.push('constant');
    if (sig.means.every(m => m <= CONSTANT_SD)) issues.push('stuck-0');
    else if (sig.means.every(m => m >= 1 - CONSTANT_SD)) issues.push('stuck-1');
    return issues;
  }
  // Clamped: ≥ 20 % of the frames of any varying component exactly at a bound
  // (constant components, e.g. an unused rgb channel at 0, do not count).
  const clamped = sig.comps.some((c, ci) => {
    if ((sig.sds[ci] ?? 0) < CONSTANT_SD) return false;
    let n = 0;
    for (let f = 0; f < c.length; f++) if (c[f]! <= 1e-6 || c[f]! >= 1 - 1e-6) n++;
    return c.length > 0 && n / c.length >= 0.2;
  });
  if (clamped) issues.push('clamped');
  return issues;
}

// ── Numbers ─────────────────────────────────────

/** Rounds to 4 significant digits; non-finite values become 0. */
export function round4(x: number): number {
  if (!Number.isFinite(x) || x === 0) return 0;
  const r = Number(x.toPrecision(4));
  return r === 0 ? 0 : r;
}

/** Mean of a numeric array (0 when empty). */
export function mean(xs: ArrayLike<number>): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i]!;
  return s / xs.length;
}

/** Pearson correlation of two equally long series (0 on zero variance). */
export function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a);
  const mb = mean(b);
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  return saa > 1e-12 && sbb > 1e-12 ? sab / Math.sqrt(saa * sbb) : 0;
}

/** Zero-lag multivariate correlation of two signals (sum of products over components). */
export function signalCorrelation(a: Signal, b: Signal): number {
  if (a.energy <= 1e-12 || b.energy <= 1e-12) return 0;
  let s = 0;
  for (let c = 0; c < a.centered.length; c++) {
    const x = a.centered[c]!;
    const y = b.centered[c];
    if (!y) continue;
    for (let f = 0; f < x.length; f++) s += x[f]! * y[f]!;
  }
  return s / Math.sqrt(a.energy * b.energy);
}

/** Wraps a phase difference (cycles) into [-0.5, 0.5). */
export function wrapCycles(d: number): number {
  return d - Math.floor(d + 0.5);
}

// ── Linear fits ─────────────────────────────────

/** Least-squares line `y = slope·x + intercept` with R². */
export function fitLine(xs: ArrayLike<number>, ys: ArrayLike<number>): { slope: number; intercept: number; r2: number } {
  const n = Math.min(xs.length, ys.length);
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx < 1e-12) return { slope: 0, intercept: my, r2: 0 };
  const slope = sxy / sxx;
  const r2 = syy < 1e-12 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept: my - slope * mx, r2 };
}

/** Least-squares plane `v = a·x + b·y + c` with R²; null when positions are collinear. */
export function fitPlane(xs: ArrayLike<number>, ys: ArrayLike<number>, vs: ArrayLike<number>): { a: number; b: number; r2: number } | null {
  const n = vs.length;
  const mx = mean(xs);
  const my = mean(ys);
  const mv = mean(vs);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sxv = 0;
  let syv = 0;
  let svv = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    const dv = vs[i]! - mv;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
    sxv += dx * dv;
    syv += dy * dv;
    svv += dv * dv;
  }
  const det = sxx * syy - sxy * sxy;
  // Relative singularity test: collinear positions → no unique plane.
  if (det <= 1e-9 * Math.max(1e-12, sxx * syy)) return null;
  const a = (sxv * syy - syv * sxy) / det;
  const b = (syv * sxx - sxv * sxy) / det;
  const explained = a * sxv + b * syv;
  return { a, b, r2: svv < 1e-12 ? 0 : explained / svv };
}

/** Indices sorted ascending by key (stable). */
export function argsort(keys: ArrayLike<number>): number[] {
  return Array.from({ length: keys.length }, (_, i) => i).sort((i, j) => keys[i]! - keys[j]! || i - j);
}

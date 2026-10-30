/**
 * `spatial` feature (ADR 0002 §6.3, amendment B6): how the samples of a
 * group relate to each other in space.
 *
 * - constant / gradient: no temporal change, equal / varying across positions;
 * - uniform: all samples move identically (pairwise correlation > 0.98);
 * - chase: per-sample phase (DFT at the group frequency) varies linearly
 *   with world position or with the instance's spread (`spatial` / `rank`);
 * - independent: anything else, with the mean pairwise correlation.
 */
import type { Spatial, Temporal } from './types';
import type { Signal } from './signal';
import { argsort, fitLine, fitPlane, mean, round4, signalCorrelation, wrapCycles } from './signal';

// ── Types / thresholds ──────────────────────────

/** A sample as seen by the spatial analysis. */
export interface SpatialSample {
  x: number;
  y: number;
  /** Position along the instance's spread (`spatial`, else `rank`), if known. */
  spread?: number;
  signal: Signal;
}

/** Context of the spatial analysis. */
export interface SpatialContext {
  /** Distribution handle (Spatial 2D axis) of a preview trace. */
  handle?: { origin: { x: number; y: number }; end: { x: number; y: number } };
}

/** Pairwise correlation above which samples count as identical. */
const UNIFORM_CORR = 0.98;
/** R² a linear phase fit needs to call a chase. */
const CHASE_R2 = 0.8;
/** Minimum spread of mean values across samples for a gradient. */
const GRADIENT_MIN = 0.02;
/** Maximum number of sample pairs used for correlations. */
const MAX_PAIRS = 2048;

// ── Phase ───────────────────────────────────────

/**
 * Per-sample phase lag (cycles in [0, 1)) at frequency `hz`, from the DFT
 * coefficient of the component with the largest total amplitude. A larger
 * lag means the sample runs later. NaN for constant samples.
 */
export function phaseLags(signals: Signal[], hz: number, fps: number): Float64Array {
  const out = new Float64Array(signals.length).fill(NaN);
  const first = signals.find(s => !s.constant);
  if (!first) return out;
  const w = (2 * Math.PI * hz) / fps;
  const arity = first.centered.length;
  const coeffs = signals.map(s =>
    s.centered.map(x => {
      let re = 0;
      let im = 0;
      for (let t = 0; t < x.length; t++) {
        re += x[t]! * Math.cos(w * t);
        im -= x[t]! * Math.sin(w * t);
      }
      return { re, im };
    }),
  );
  // Reference component: largest summed magnitude.
  let ref = 0;
  let refMag = -1;
  for (let c = 0; c < arity; c++) {
    let m = 0;
    for (const cs of coeffs) m += Math.hypot(cs[c]?.re ?? 0, cs[c]?.im ?? 0);
    if (m > refMag) {
      refMag = m;
      ref = c;
    }
  }
  signals.forEach((s, i) => {
    const z = coeffs[i]?.[ref];
    if (s.constant || !z || Math.hypot(z.re, z.im) < 1e-9) return;
    const lag = -Math.atan2(z.im, z.re) / (2 * Math.PI);
    out[i] = lag - Math.floor(lag);
  });
  return out;
}

/** Unwraps circular lags (cycles) along `order` so consecutive steps are in [-0.5, 0.5). */
export function unwrapAlong(lags: ArrayLike<number>, order: number[]): Float64Array {
  const out = new Float64Array(lags.length);
  let prev = -1;
  for (const i of order) {
    out[i] = prev < 0 ? lags[i]! : out[prev]! + wrapCycles(lags[i]! - lags[prev]!);
    prev = i;
  }
  return out;
}

// ── Position fit ────────────────────────────────

/** Linear fit of values over world positions: gradient `(a, b)` and R². */
interface PositionFit {
  a: number;
  b: number;
  r2: number;
  values: Float64Array;
}

/**
 * Fits values linearly over positions. Candidate directions (5° steps)
 * order the samples (`valuesFor` may depend on the order, e.g. for phase
 * unwrapping); the best 1D fit is refined by a plane fit when the
 * positions are not collinear. Null when all positions coincide.
 */
export function fitPositions(xs: Float64Array, ys: Float64Array, valuesFor: (order: number[]) => Float64Array): PositionFit | null {
  let best: PositionFit | null = null;
  for (let deg = 0; deg < 180; deg += 5) {
    const c = Math.cos((deg * Math.PI) / 180);
    const s = Math.sin((deg * Math.PI) / 180);
    const proj = xs.map((x, i) => x * c + ys[i]! * s);
    const pm = mean(proj);
    if (proj.reduce((acc, p) => acc + (p - pm) ** 2, 0) < 1e-9) continue;
    const values = valuesFor(argsort(proj));
    const line = fitLine(proj, values);
    if (!best || line.r2 > best.r2 + 1e-9) best = { a: line.slope * c, b: line.slope * s, r2: line.r2, values };
  }
  if (!best) return null;
  const plane = fitPlane(xs, ys, best.values);
  if (plane && plane.r2 >= best.r2 - 1e-9) return { a: plane.a, b: plane.b, r2: plane.r2, values: best.values };
  return best;
}

/**
 * Median step between consecutive unwrapped lags sorted by `keys`
 * (ignoring near-equal keys). The median keeps gaps (e.g. a stuck fixture
 * left out of the chase) from inflating the step.
 */
function medianStep(keys: Float64Array, lags: Float64Array): number {
  const order = argsort(keys);
  const unwrapped = unwrapAlong(lags, order);
  const span = keys[order[order.length - 1]!]! - keys[order[0]!]!;
  const steps: number[] = [];
  for (let i = 1; i < order.length; i++) {
    const a = order[i - 1]!;
    const b = order[i]!;
    if (keys[b]! - keys[a]! > 1e-3 * span) steps.push(unwrapped[b]! - unwrapped[a]!);
  }
  steps.sort((a, b) => a - b);
  if (steps.length === 0) return 0;
  const mid = steps.length >> 1;
  return steps.length % 2 === 1 ? steps[mid]! : (steps[mid - 1]! + steps[mid]!) / 2;
}

/** Unit vector of `(a, b)` (`[1, 0]` when zero), rounded. */
function unit(a: number, b: number): [number, number] {
  const len = Math.hypot(a, b);
  return len > 1e-12 ? [round4(a / len), round4(b / len)] : [1, 0];
}

// ── Correlation ─────────────────────────────────

/** Mean and minimum zero-lag correlation over (a bounded number of) sample pairs. */
export function pairwiseCorrelation(signals: Signal[]): { mean: number; min: number } {
  const n = signals.length;
  if (n < 2) return { mean: 1, min: 1 };
  const partners = Math.max(1, Math.min(n - 1, Math.ceil((2 * MAX_PAIRS) / n)));
  let sum = 0;
  let count = 0;
  let min = 1;
  for (let i = 0; i < n; i++) {
    for (let k = 1; k <= partners; k++) {
      const j = (i + k) % n;
      // Each unordered pair once when all pairs are covered.
      if (partners === n - 1 && j < i) continue;
      const c = signalCorrelation(signals[i]!, signals[j]!);
      sum += c;
      count++;
      min = Math.min(min, c);
    }
  }
  return { mean: count > 0 ? sum / count : 1, min };
}

// ── Spatial ─────────────────────────────────────

/** Gradient / constant verdict of samples that do not change over time. */
function staticSpatial(samples: SpatialSample[]): Spatial {
  const values = Float64Array.from(samples.map(s => mean(s.signal.intensity)));
  const span = Math.max(...values) - Math.min(...values);
  if (span < GRADIENT_MIN) return { kind: 'constant' };
  const xs = Float64Array.from(samples.map(s => s.x));
  const ys = Float64Array.from(samples.map(s => s.y));
  const fit = fitPositions(xs, ys, () => values);
  return { kind: 'gradient', direction: fit ? unit(fit.a, fit.b) : [1, 0], span: round4(span) };
}

/** Chase verdict of periodic samples from their phase lags; null when no linear fit. */
function chase(samples: SpatialSample[], lags: Float64Array, hz: number, ctx: SpatialContext): Spatial | null {
  const idx = samples.map((_, i) => i).filter(i => Number.isFinite(lags[i]!));
  if (idx.length < 3) return null;
  const l = Float64Array.from(idx.map(i => lags[i]!));
  const xs = Float64Array.from(idx.map(i => samples[i]!.x));
  const ys = Float64Array.from(idx.map(i => samples[i]!.y));
  const pos = fitPositions(xs, ys, order => unwrapAlong(l, order));
  // Spread axis (ADR B6): phase vs. `spatial` / `rank`.
  const spreads = idx.map(i => samples[i]!.spread);
  let spread: { slope: number; r2: number; keys: Float64Array } | null = null;
  if (spreads.every(s => s !== undefined && Number.isFinite(s))) {
    const keys = Float64Array.from(spreads as number[]);
    const line = fitLine(keys, unwrapAlong(l, argsort(keys)));
    spread = { slope: line.slope, r2: line.r2, keys };
  }
  const posOk = pos !== null && pos.r2 > CHASE_R2;
  const spreadOk = spread !== null && spread.r2 > CHASE_R2;
  if (!posOk && !spreadOk) return null;
  // Tiny lag spread: in phase, not a chase.
  const values = pos?.values ?? l;
  if (Math.max(...values) - Math.min(...values) < 0.02) return null;
  if (spread && spreadOk && (!posOk || spread.r2 > pos!.r2 + 0.02)) {
    const sign = spread.slope >= 0 ? 1 : -1;
    let direction: [number, number] = pos ? unit(pos.a, pos.b) : [1, 0];
    let speed: number | undefined;
    if (ctx.handle) {
      const dx = ctx.handle.end.x - ctx.handle.origin.x;
      const dy = ctx.handle.end.y - ctx.handle.origin.y;
      direction = unit(sign * dx, sign * dy);
      if (Math.abs(spread.slope) > 1e-9) speed = round4((hz * Math.hypot(dx, dy)) / Math.abs(spread.slope));
    }
    const step = Math.abs(medianStep(spread.keys, l));
    return speed !== undefined
      ? { kind: 'chase', direction, step: round4(step), speed, axis: 'spread' }
      : { kind: 'chase', direction, step: round4(step), axis: 'spread' };
  }
  const p = pos!;
  const len = Math.hypot(p.a, p.b);
  const direction = unit(p.a, p.b);
  const proj = xs.map((x, i) => x * direction[0] + ys[i]! * direction[1]);
  const step = medianStep(proj, l);
  return len > 1e-9
    ? { kind: 'chase', direction, step: round4(step), speed: round4(hz / len), axis: 'position' }
    : { kind: 'chase', direction, step: round4(step), axis: 'position' };
}

/**
 * Spatial verdict of a group. `lags` are the per-sample phase lags at the
 * group frequency (periodic groups only).
 */
export function analyzeSpatial(samples: SpatialSample[], temporal: Temporal, lags: Float64Array | null, ctx: SpatialContext): Spatial {
  if (samples.length === 0) return { kind: 'constant' };
  const active = samples.filter(s => !s.signal.constant);
  if (active.length === 0) return staticSpatial(samples);
  if (samples.length === 1) return { kind: 'uniform' };
  const corr = pairwiseCorrelation(active.map(s => s.signal));
  if (active.length === samples.length && corr.min > UNIFORM_CORR) return { kind: 'uniform' };
  if (temporal.kind === 'periodic' && lags) {
    const c = chase(samples, lags, temporal.hz, ctx);
    if (c) return c;
  }
  return { kind: 'independent', corr: round4(corr.mean) };
}

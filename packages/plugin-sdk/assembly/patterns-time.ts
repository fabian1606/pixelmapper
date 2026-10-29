/**
 * Time pattern helpers: easing curves, meeting times of moving points and a
 * trigger envelope. All functions are pure and deterministic (f32).
 */
import { fract, smoothstep, PI } from "./math";

// ── Easing ───────────────────────────────────

/** `ease` kind: identity. */
export const EASE_LINEAR: i32 = 0;
/** `ease` kind: t², slow start. */
export const EASE_IN_QUAD: i32 = 1;
/** `ease` kind: 1 − (1 − t)², slow end. */
export const EASE_OUT_QUAD: i32 = 2;
/** `ease` kind: quadratic in, then out. */
export const EASE_IN_OUT_QUAD: i32 = 3;
/** `ease` kind: 2^(10t − 10), very slow start. */
export const EASE_IN_EXPO: i32 = 4;
/** `ease` kind: 1 − 2^(−10t), very fast start. */
export const EASE_OUT_EXPO: i32 = 5;
/** `ease` kind: (1 − cos(πt)) / 2. */
export const EASE_IN_OUT_SINE: i32 = 6;
/** `ease` kind: Hermite smoothstep t²(3 − 2t). */
export const EASE_SMOOTH: i32 = 7;

/**
 * Easing curve `kind` (an `EASE_*` constant, e.g. from an enum param)
 * applied to `t`. `t` is clamped to [0, 1]; every curve maps 0 → 0 and
 * 1 → 1 exactly. Unknown kinds behave like `EASE_LINEAR`.
 *
 * ```ts
 * const v = ease(this.params.int(0), fract(ctx.timePhase));
 * ```
 */
export function ease(kind: i32, t: f32): f32 {
  if (t <= 0.0) return 0.0;
  if (t >= 1.0) return 1.0;
  switch (kind) {
    case EASE_IN_QUAD: return t * t;
    case EASE_OUT_QUAD: return 1.0 - (1.0 - t) * (1.0 - t);
    case EASE_IN_OUT_QUAD: {
      if (t < 0.5) return 2.0 * t * t;
      const u: f32 = 2.0 - 2.0 * t;
      return 1.0 - u * u * 0.5;
    }
    case EASE_IN_EXPO: return Mathf.pow(2.0, 10.0 * t - 10.0);
    case EASE_OUT_EXPO: return 1.0 - Mathf.pow(2.0, -10.0 * t);
    case EASE_IN_OUT_SINE: return (1.0 - Mathf.cos(PI * t)) * 0.5;
    case EASE_SMOOTH: return smoothstep(t);
    default: return t;
  }
}

// ── Crossings ────────────────────────────────

/**
 * First time `t` ≥ 0 at which two points on an infinite line meet:
 * a0 + va·t == b0 + vb·t ⇒ t = (b0 − a0) / (va − vb).
 * Units: positions in any unit, speeds in that unit per time unit (e.g.
 * cycles or seconds). Returns −1 when they never meet (the meeting lies in
 * the past, or parallel motion with different starts); 0 when they start
 * together (parallel and equal starts: always together).
 */
export function crossingTimeLine(a0: f32, va: f32, b0: f32, vb: f32): f32 {
  const gap = b0 - a0;
  const dv = va - vb;
  if (dv == 0.0) return gap == 0.0 ? <f32>0.0 : <f32>-1.0;
  const t = gap / dv;
  return t >= 0.0 ? t : <f32>-1.0;
}

/**
 * Time since the most recent meeting of two points moving on a loop of
 * length 1 (positions wrap with `fract`, e.g. a ring of fixtures):
 * a(t) = fract(a0 + va·t), b(t) = fract(b0 + vb·t). Returns how long ago
 * (≥ 0, same time unit as the speeds) they last met at or before `t`.
 *
 * Math: the relative position k(t) = (a0 − b0) + (va − vb)·t; they meet
 * whenever k is an integer, i.e. every period 1 / |va − vb|. The motion is
 * treated as eternal, so the result is always in [0, period) — also for
 * `t` before the first meeting after 0. Returns −1 when they never meet
 * (equal speeds, different starts) and 0 for equal speeds and starts.
 *
 * ```ts
 * // flash for 0.2 time units after two runners pass each other
 * const since = crossingTimeLoop(0.0, 0.3, 0.5, -0.2, ctx.timePhase);
 * out.setScalar(since >= 0.0 && since < 0.2 ? 1.0 - since / 0.2 : 0.0);
 * ```
 */
export function crossingTimeLoop(a0: f32, va: f32, b0: f32, vb: f32, t: f32): f32 {
  const dv = va - vb;
  const k = (a0 - b0) + dv * t;
  if (dv == 0.0) return fract(k) == 0.0 ? <f32>0.0 : <f32>-1.0;
  return dv > 0.0 ? fract(k) / dv : fract(-k) / -dv;
}

/**
 * Number of meetings of the two loop points (see `crossingTimeLoop`) in the
 * time interval (0, t]: floor(k(t)) − floor(k(0)) for va > vb (mirrored
 * for va < vb). 0 for `t` ≤ 0 and for equal speeds. Useful to alternate
 * colors per collision: `crossingCount(…) & 1`.
 */
export function crossingCount(a0: f32, va: f32, b0: f32, vb: f32, t: f32): i32 {
  const dv = va - vb;
  if (t <= 0.0 || dv == 0.0) return 0;
  const k0 = a0 - b0;
  const k1 = k0 + dv * t;
  return dv > 0.0
    ? <i32>(Mathf.floor(k1) - Mathf.floor(k0))
    : <i32>(Mathf.floor(-k1) - Mathf.floor(-k0));
}

// ── Envelope ─────────────────────────────────

/**
 * Attack/decay envelope for trigger params (`msSince` = milliseconds since
 * the press or release). Phases:
 * - `msSince` < 0 → 0 (not triggered yet);
 * - attack: linear 0 → 1 over `attackMs` (≤ 0 = instant jump to 1);
 * - decay: linear 1 → 0 over `decayMs` (≤ 0 = instant drop to 0 right after
 *   the attack, so attack ≤ 0 and decay ≤ 0 together give always 0);
 * - afterwards 0.
 * Linear segments keep the timing predictable; shape them with `ease`.
 *
 * ```ts
 * out.setScalar(ease(EASE_OUT_QUAD, envelope(msSincePress, 50.0, 800.0)));
 * ```
 */
export function envelope(msSince: f32, attackMs: f32, decayMs: f32): f32 {
  if (msSince < 0.0) return 0.0;
  const attack = attackMs > 0.0 ? attackMs : <f32>0.0;
  if (msSince < attack) return msSince / attack;
  const dt = msSince - attack;
  if (decayMs <= 0.0 || dt >= decayMs) return 0.0;
  return 1.0 - dt / decayMs;
}

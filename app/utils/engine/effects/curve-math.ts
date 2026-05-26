import type { CurvePoint } from '../types';

// ─── Catmull-Rom sampling ─────────────────────────────────────────────────────

/** Centripetal Catmull-Rom evaluation between p1 and p2, using p0 and p3 as knots. */
function catmullRomSegment(
  p0: CurvePoint, p1: CurvePoint, p2: CurvePoint, p3: CurvePoint,
  t: number,
): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1.y) +
    (-p0.y + p2.y) * t +
    (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
    (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
  );
}

/**
 * Samples the Catmull-Rom spline defined by `points` at normalized position x ∈ [0,1].
 * Points must be sorted by x (monotonically increasing) with points[0].x == 0 and last x == 1.
 * Returns the y value (clamped to >= 0).
 */
export function sampleCurve(points: CurvePoint[], x: number): number {
  if (points.length < 2) return 1;
  const n = points.length;
  const clamped = Math.max(0, Math.min(1, x));

  // Find the segment containing x
  let i = 1;
  while (i < n - 1 && points[i]!.x < clamped) i++;
  const p1 = points[i - 1]!;
  const p2 = points[i]!;

  // Local t within this segment
  const segW = p2.x - p1.x;
  const localT = segW < 1e-9 ? 0 : (clamped - p1.x) / segW;

  // Phantom points for clamping at boundaries
  const p0 = i > 1 ? points[i - 2]! : { x: p1.x - (p2.x - p1.x), y: p1.y };
  const p3 = i < n - 1 ? points[i + 1]! : { x: p2.x + (p2.x - p1.x), y: p2.y };

  return Math.max(0, catmullRomSegment(p0, p1, p2, p3, localT));
}

// ─── Cumulative integral (LUT) ────────────────────────────────────────────────

const LUT_SAMPLES = 256;

/**
 * Builds a cumulative integral F(t) for the curve, using the trapezoid rule.
 * Returns an array of length `LUT_SAMPLES + 1` where entry i = F(i / LUT_SAMPLES).
 */
export function buildCumulative(points: CurvePoint[]): Float32Array {
  const lut = new Float32Array(LUT_SAMPLES + 1);
  let sum = 0;
  let prev = sampleCurve(points, 0);
  lut[0] = 0;
  for (let i = 1; i <= LUT_SAMPLES; i++) {
    const t = i / LUT_SAMPLES;
    const curr = sampleCurve(points, t);
    sum += (prev + curr) * 0.5 / LUT_SAMPLES;
    lut[i] = sum;
    prev = curr;
  }
  return lut;
}

/**
 * Given a cumulative LUT (from buildCumulative) and a linear phase t ∈ [0,1],
 * returns the warped phase τ(t) ∈ [0,1] via binary search in F⁻¹.
 * Guarantees τ(0) = 0 and τ(1) = 1 regardless of curve shape.
 */
export function warpPhase(lut: Float32Array, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const total = lut[LUT_SAMPLES]!;
  if (total < 1e-9) return t; // flat-zero curve fallback
  const target = t * total;

  // Binary search
  let lo = 0, hi = LUT_SAMPLES;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (lut[mid]! <= target) lo = mid; else hi = mid;
  }
  // Linear interpolation between lo and hi
  const lutLo = lut[lo]!;
  const lutHi = lut[hi]!;
  const frac = lutHi - lutLo < 1e-12 ? 0 : (target - lutLo) / (lutHi - lutLo);
  return (lo + frac) / LUT_SAMPLES;
}

/**
 * Warps an absolute time value using the speed curve, keeping beat-phase integrity.
 * `cycleDurationMs` = one full curve cycle in milliseconds (beatPeriodMs × cycleBeats).
 * Returns a new absolute time in ms where the phase within each cycle is warped.
 */
export function warpTime(lut: Float32Array, time: number, cycleDurationMs: number): number {
  if (cycleDurationMs < 1) return time;
  const cycles = Math.floor(time / cycleDurationMs);
  const phase = (time % cycleDurationMs) / cycleDurationMs;
  const warpedPhase = warpPhase(lut, phase);
  return cycles * cycleDurationMs + warpedPhase * cycleDurationMs;
}

// ─── Preset curves ────────────────────────────────────────────────────────────

export interface CurvePreset {
  label: string;
  points: CurvePoint[];
}

export const CURVE_PRESETS: CurvePreset[] = [
  { label: 'Flat',        points: [{ x: 0, y: 1 }, { x: 1, y: 1 }] },
  { label: 'Ease-In',     points: [{ x: 0, y: 0.2 }, { x: 0.5, y: 0.8 }, { x: 1, y: 3 }] },
  { label: 'Ease-Out',    points: [{ x: 0, y: 3 }, { x: 0.5, y: 0.8 }, { x: 1, y: 0.2 }] },
  { label: 'Ease-InOut',  points: [{ x: 0, y: 0.2 }, { x: 0.25, y: 0.4 }, { x: 0.75, y: 2.5 }, { x: 1, y: 0.2 }] },
  { label: 'Pulse',       points: [{ x: 0, y: 0.1 }, { x: 0.3, y: 3.5 }, { x: 0.5, y: 3.5 }, { x: 1, y: 0.1 }] },
  { label: 'Stop-and-Go', points: [{ x: 0, y: 0.05 }, { x: 0.45, y: 0.05 }, { x: 0.55, y: 4 }, { x: 1, y: 0.05 }] },
  { label: 'Sawtooth',    points: [{ x: 0, y: 0.1 }, { x: 0.8, y: 3 }, { x: 1, y: 0.1 }] },
];

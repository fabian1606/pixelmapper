/**
 * Curve param sampling (ADR §6.2).
 *
 * Curves are lists of normalized control points interpolated with a
 * Catmull-Rom spline. The host samples them into a fixed-size LUT for the
 * params wire block (`curve` = 128 f32), and `pm.curve` uses the same
 * sampling for drawing.
 */
import type { CurvePoint } from '@pixelmapper/extension-api';

/** Number of f32 slots a curve param occupies on the wire. */
export const CURVE_LUT_SIZE = 128;

/** Catmull-Rom evaluation between p1 and p2 with p0/p3 as outer knots. */
function catmullRomSegment(p0: CurvePoint, p1: CurvePoint, p2: CurvePoint, p3: CurvePoint, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1.y)
    + (-p0.y + p2.y) * t
    + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2
    + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
  );
}

/**
 * Samples the spline through `points` (sorted by x) at `x` ∈ [0, 1].
 * Returns `fallback` for fewer than two points. The result is not clamped
 * above; callers clamp to their value range.
 */
export function sampleCurve(points: readonly CurvePoint[], x: number, fallback = 0): number {
  const n = points.length;
  if (n === 0) return fallback;
  if (n === 1) return points[0]!.y;
  const cx = Math.max(0, Math.min(1, x));

  let i = 1;
  while (i < n - 1 && points[i]!.x < cx) i++;
  const p1 = points[i - 1]!;
  const p2 = points[i]!;
  const segW = p2.x - p1.x;
  const localT = segW < 1e-9 ? 0 : Math.max(0, Math.min(1, (cx - p1.x) / segW));

  // Phantom knots at the boundaries keep the ends flat.
  const p0 = i > 1 ? points[i - 2]! : { x: p1.x - segW, y: p1.y };
  const p3 = i < n - 1 ? points[i + 1]! : { x: p2.x + segW, y: p2.y };

  return Math.max(0, catmullRomSegment(p0, p1, p2, p3, localT));
}

/** Samples a curve into a LUT of `size` values clamped to [0, 1]. */
export function sampleCurveLut(points: readonly CurvePoint[], size = CURVE_LUT_SIZE): Float32Array {
  const lut = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    lut[i] = Math.min(1, sampleCurve(points, size === 1 ? 0 : i / (size - 1)));
  }
  return lut;
}

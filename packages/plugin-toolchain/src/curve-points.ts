/**
 * Free-point curve sampling (plan M1.3). Points are normalized 0–1 on both
 * axes and sorted by x.
 *
 * - Legacy `CurvePoint[]` (no point has `kind`/`in`/`out`): Catmull-Rom
 *   spline, bit-identical to the v1 sampler.
 * - v2 points: each segment follows the *left* point's kind:
 *   `smooth`/`corner` = cubic Bézier from the left point's `out` handle to
 *   the right point's `in` handle (default handles: Catmull-Rom tangent,
 *   ⅓ of the segment), `linear`, or `step` (holds the left y).
 */
import type { CurveHandle, CurvePoint, CurvePointV2 } from '@pixelmapper/extension-api';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Catmull-Rom evaluation between p1 and p2 with p0/p3 as outer knots. */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/**
 * Samples the legacy Catmull-Rom spline through `points` at `x` ∈ [0, 1].
 * Returns `fallback` for an empty list; never negative.
 */
export function sampleCurve(points: readonly CurvePoint[], x: number, fallback = 0): number {
  const n = points.length;
  if (n === 0) return fallback;
  if (n === 1) return points[0]!.y;
  const cx = clamp01(x);
  let i = 1;
  while (i < n - 1 && points[i]!.x < cx) i++;
  const p1 = points[i - 1]!;
  const p2 = points[i]!;
  const segW = p2.x - p1.x;
  const t = segW < 1e-9 ? 0 : clamp01((cx - p1.x) / segW);
  const p0y = i > 1 ? points[i - 2]!.y : p1.y;
  const p3y = i < n - 1 ? points[i + 1]!.y : p2.y;
  return Math.max(0, catmullRom(p0y, p1.y, p2.y, p3y, t));
}

/** True when no point carries v2 fields (legacy Catmull-Rom list). */
export function isLegacyPoints(points: readonly CurvePointV2[]): boolean {
  return points.every(p => p.kind === undefined && p.in === undefined && p.out === undefined);
}

/** Catmull-Rom slope at point `i` (one-sided at the ends). */
function tangent(points: readonly CurvePointV2[], i: number): number {
  const a = points[Math.max(0, i - 1)]!;
  const b = points[Math.min(points.length - 1, i + 1)]!;
  const dx = b.x - a.x;
  return dx < 1e-9 ? 0 : (b.y - a.y) / dx;
}

/** Outgoing handle of point `i` (explicit or the default ⅓-segment tangent). */
export function outHandle(points: readonly CurvePointV2[], i: number): CurveHandle {
  const p = points[i]!;
  const w = (points[i + 1]?.x ?? p.x) - p.x;
  if (p.out) return { dx: Math.max(0, Math.min(w, p.out.dx)), dy: p.out.dy };
  const dx = w / 3;
  return { dx, dy: tangent(points, i) * dx };
}

/** Incoming handle of point `i` (explicit or the default ⅓-segment tangent). */
export function inHandle(points: readonly CurvePointV2[], i: number): CurveHandle {
  const p = points[i]!;
  const w = p.x - (points[i - 1]?.x ?? p.x);
  if (p.in) return { dx: Math.min(0, Math.max(-w, p.in.dx)), dy: p.in.dy };
  const dx = -w / 3;
  return { dx, dy: tangent(points, i) * dx };
}

/** One coordinate of a cubic Bézier at parameter t. */
function bez(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

/** y of the Bézier segment between points `i` and `i + 1` at `x` (x is monotonic in t). */
function bezierAt(points: readonly CurvePointV2[], i: number, x: number): number {
  const p0 = points[i]!;
  const p3 = points[i + 1]!;
  const o = outHandle(points, i);
  const n = inHandle(points, i + 1);
  const x1 = p0.x + o.dx;
  const x2 = p3.x + n.dx;
  let lo = 0;
  let hi = 1;
  // Bisection on x(t): handles are clamped into the segment, so x(t) is monotonic.
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (bez(p0.x, x1, x2, p3.x, mid) < x) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  return bez(p0.y, p0.y + o.dy, p3.y + n.dy, p3.y, t);
}

/**
 * Samples free points at `x` ∈ [0, 1]. Legacy lists use Catmull-Rom; v2
 * lists evaluate per segment by the left point's kind. Clamped to [0, 1].
 */
export function evaluatePoints(points: readonly CurvePointV2[], x: number, fallback = 0): number {
  if (isLegacyPoints(points)) return Math.min(1, sampleCurve(points, x, fallback));
  const n = points.length;
  if (n === 0) return fallback;
  const cx = clamp01(x);
  if (n === 1 || cx <= points[0]!.x) return clamp01(points[0]!.y);
  if (cx >= points[n - 1]!.x) return clamp01(points[n - 1]!.y);
  let i = 0;
  while (i < n - 2 && points[i + 1]!.x < cx) i++;
  const a = points[i]!;
  const b = points[i + 1]!;
  const w = b.x - a.x;
  if (w < 1e-9) return clamp01(b.y);
  switch (a.kind ?? 'smooth') {
    case 'step': return clamp01(a.y);
    case 'linear': return clamp01(a.y + (b.y - a.y) * ((cx - a.x) / w));
    default: return clamp01(bezierAt(points, i, cx));
  }
}

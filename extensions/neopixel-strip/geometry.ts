/**
 * Geometry helpers for NeoPixel strip polylines rendered as a Catmull-Rom
 * spline (each segment is a cubic Bézier with tangents derived from the
 * neighbouring control points).
 *
 * Everything here works in world pixels relative to the fixture origin —
 * the same space as `StripConfig.points`. Curves are sampled here (inside
 * the kind's `build`); the core only ever sees the resulting polylines.
 */
import type { StripPoint, StripShapeType } from './config';

// ─── Catmull-Rom → cubic Bézier conversion ────────────────────────────────────

export interface CubicBezier {
  p0: StripPoint;
  c1: StripPoint;
  c2: StripPoint;
  p1: StripPoint;
}

/**
 * For a polyline of N control points, returns N-1 cubic Bézier segments
 * forming a Catmull-Rom spline that passes through every control point.
 *
 * Endpoints use mirrored phantom points so the curve has a sensible tangent
 * at the strip's ends. With only 2 points this collapses to a straight line.
 */
export function catmullRomBeziers(points: StripPoint[]): CubicBezier[] {
  if (points.length < 2) return [];
  const out: CubicBezier[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i]!;
    const p1 = points[i + 1]!;
    // Phantom point before segment start: mirror across p0 when at the boundary.
    const pm1 = i === 0
      ? { x: 2 * p0.x - p1.x, y: 2 * p0.y - p1.y }
      : points[i - 1]!;
    // Phantom point after segment end: mirror across p1 at the boundary.
    const p2 = i + 2 >= points.length
      ? { x: 2 * p1.x - p0.x, y: 2 * p1.y - p0.y }
      : points[i + 2]!;
    out.push({
      p0: { x: p0.x, y: p0.y },
      c1: { x: p0.x + (p1.x - pm1.x) / 6, y: p0.y + (p1.y - pm1.y) / 6 },
      c2: { x: p1.x - (p2.x - p0.x) / 6, y: p1.y - (p2.y - p0.y) / 6 },
      p1: { x: p1.x, y: p1.y },
    });
  }
  return out;
}

/** Evaluates a cubic Bézier at parameter t∈[0,1]. */
export function bezierPoint(b: CubicBezier, t: number): StripPoint {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  const w0 = uu * u;
  const w1 = 3 * uu * t;
  const w2 = 3 * u * tt;
  const w3 = tt * t;
  return {
    x: w0 * b.p0.x + w1 * b.c1.x + w2 * b.c2.x + w3 * b.p1.x,
    y: w0 * b.p0.y + w1 * b.c1.y + w2 * b.c2.y + w3 * b.p1.y,
  };
}

// ─── Arc-length ───────────────────────────────────────────────────────────────

/** Samples per Bézier segment for arc-length integration. 32 → < ~0.5% error for typical strips. */
const ARC_SAMPLES = 32;

/** Numerical arc length of one cubic Bézier via sampled chord summation. */
export function bezierLength(b: CubicBezier, samples = ARC_SAMPLES): number {
  let len = 0;
  let prev = b.p0;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const p = bezierPoint(b, t);
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    len += Math.hypot(dx, dy);
    prev = p;
  }
  return len;
}

/** Total Catmull-Rom curve length for a polyline. */
export function curveLength(points: StripPoint[]): number {
  let total = 0;
  for (const b of catmullRomBeziers(points)) total += bezierLength(b);
  return total;
}

/**
 * Samples the Catmull-Rom curve at uniform `count` points and returns them
 * together with the cumulative arc length at each sample. Used by the
 * renderer's hit-test (TS-side) and as ground truth for length enforcement.
 */
export interface SampledCurve {
  points: StripPoint[];
  cumulative: number[]; // length-N+1 (includes 0 prefix)
  totalLength: number;
}
export function sampleCurve(points: StripPoint[], samplesPerSegment = ARC_SAMPLES): SampledCurve {
  const beziers = catmullRomBeziers(points);
  const out: StripPoint[] = [];
  const cum: number[] = [];
  let total = 0;

  if (beziers.length === 0) {
    return { points: points.map(p => ({ ...p })), cumulative: [0], totalLength: 0 };
  }

  // Emit p0 of the first segment first.
  out.push({ ...beziers[0]!.p0 });
  cum.push(0);

  for (const b of beziers) {
    let prev = out[out.length - 1]!;
    for (let i = 1; i <= samplesPerSegment; i++) {
      const t = i / samplesPerSegment;
      const p = bezierPoint(b, t);
      total += Math.hypot(p.x - prev.x, p.y - prev.y);
      out.push(p);
      cum.push(total);
      prev = p;
    }
  }
  return { points: out, cumulative: cum, totalLength: total };
}

/**
 * Returns a sampled curve whose arc length is exactly `targetLength`, walked
 * from `points[0]` (the star anchor): too-long polylines are trimmed, too-short
 * polylines are extended in the last tangent direction. Mirrors
 * `sample_strip_curve_capped` in [rs-engine/canvas/src/render.rs](rs-engine/canvas/src/render.rs)
 * so modifier-evaluation positions land on the same LEDs the renderer draws.
 */
export function sampleCurveCapped(points: StripPoint[], targetLength: number): SampledCurve {
  const raw = sampleCurve(points);
  if (targetLength <= 0 || raw.points.length === 0) return raw;
  const total = raw.totalLength;

  if (total > targetLength) {
    let cutoff = raw.points.length;
    for (let i = 0; i < raw.cumulative.length; i++) {
      if (raw.cumulative[i]! >= targetLength) { cutoff = i; break; }
    }
    if (cutoff < raw.points.length) {
      const s0 = raw.cumulative[cutoff - 1]!;
      const s1 = raw.cumulative[cutoff]!;
      const t = (targetLength - s0) / Math.max(s1 - s0, 0.0001);
      const p0 = raw.points[cutoff - 1]!;
      const p1 = raw.points[cutoff]!;
      const trimmed: StripPoint[] = raw.points.slice(0, cutoff);
      const cum: number[] = raw.cumulative.slice(0, cutoff);
      trimmed.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t });
      cum.push(targetLength);
      return { points: trimmed, cumulative: cum, totalLength: targetLength };
    }
    return raw;
  }

  if (total < targetLength && raw.points.length >= 2) {
    const last = raw.points[raw.points.length - 1]!;
    const prev = raw.points[raw.points.length - 2]!;
    const dx = last.x - prev.x;
    const dy = last.y - prev.y;
    const mag = Math.max(Math.hypot(dx, dy), 0.0001);
    const extra = targetLength - total;
    const extended: StripPoint[] = [...raw.points, { x: last.x + (dx / mag) * extra, y: last.y + (dy / mag) * extra }];
    const cum: number[] = [...raw.cumulative, targetLength];
    return { points: extended, cumulative: cum, totalLength: targetLength };
  }

  return raw;
}

// ─── Shape-specific sampling ─────────────────────────────────────────────────

/** Number of samples used to discretize a circle (one full revolution). */
const CIRCLE_SAMPLES = 96;

/**
 * Linear sample of a 2-point straight segment, length-capped to `targetLength`.
 * If the segment is shorter than `targetLength`, it's extended along its
 * direction (or +x if degenerate). Always returns ≥ 2 samples.
 */
export function sampleLineCapped(points: StripPoint[], targetLength: number): SampledCurve {
  if (points.length < 1) return { points: [], cumulative: [0], totalLength: 0 };
  const p0 = points[0]!;
  const p1 = points[1] ?? { x: p0.x + targetLength, y: p0.y };
  let dx = p1.x - p0.x;
  let dy = p1.y - p0.y;
  let len = Math.hypot(dx, dy);
  if (len < 0.0001) { dx = 1; dy = 0; len = 1; }
  const ux = dx / len;
  const uy = dy / len;
  const tLen = Math.max(targetLength, 0);
  const steps = 24;
  const out: StripPoint[] = [];
  const cum: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const s = (i / steps) * tLen;
    out.push({ x: p0.x + ux * s, y: p0.y + uy * s });
    cum.push(s);
  }
  return { points: out, cumulative: cum, totalLength: tLen };
}

/**
 * Parametric circle sample around a single center point.
 *
 * `targetLength` is interpreted as the circle's **diameter** (derived from
 * `ledCount / ledsPerMeter`) — so the visible circle's width matches the
 * physical strip length. The geometric arc length the LEDs are distributed
 * over is the full circumference `π · diameter`.
 *
 * LED 0 sits at 12 o'clock (angle -π/2) and the strip wraps clockwise.
 */
export function sampleCircle(center: StripPoint | undefined, targetLength: number, clockwise = true): SampledCurve {
  const c = center ?? { x: 0, y: 0 };
  const diameter = Math.max(targetLength, 0);
  if (diameter <= 0.0001) {
    return { points: [{ ...c }], cumulative: [0], totalLength: 0 };
  }
  const radius = diameter / 2;
  const circumference = 2 * Math.PI * radius;
  const dir = clockwise ? 1 : -1;
  const out: StripPoint[] = [];
  const cum: number[] = [];
  for (let i = 0; i <= CIRCLE_SAMPLES; i++) {
    const t = i / CIRCLE_SAMPLES;
    // Start at 12 o'clock (-π/2), direction controlled by clockwise flag.
    const angle = -Math.PI / 2 + dir * t * 2 * Math.PI;
    out.push({
      x: c.x + Math.cos(angle) * radius,
      y: c.y + Math.sin(angle) * radius,
    });
    cum.push(t * circumference);
  }
  return { points: out, cumulative: cum, totalLength: circumference };
}

/**
 * Shape-aware dispatcher: returns a capped polyline sampling of the strip's
 * geometry. Both renderer and modifier-evaluation use this so LED positions
 * line up exactly between TS and Rust.
 */
export function sampleStripCapped(
  shape: StripShapeType,
  points: StripPoint[],
  targetLength: number,
  clockwise = true,
): SampledCurve {
  switch (shape) {
    case 'line':   return sampleLineCapped(points, targetLength);
    case 'circle': return sampleCircle(points[0], targetLength, clockwise);
    case 'bezier':
    default:       return sampleCurveCapped(points, targetLength);
  }
}

/** Shape-aware AABB of the visible strip geometry. */
export function stripBounds(
  shape: StripShapeType,
  points: StripPoint[],
  targetLength: number,
): Bounds {
  if (shape === 'circle') {
    const c = points[0] ?? { x: 0, y: 0 };
    // targetLength = diameter (see sampleCircle), so radius = targetLength / 2.
    const r = Math.max(targetLength, 0) / 2;
    return { minX: c.x - r, minY: c.y - r, maxX: c.x + r, maxY: c.y + r };
  }
  if (shape === 'line') {
    const p0 = points[0] ?? { x: 0, y: 0 };
    const p1 = points[1] ?? { x: p0.x + targetLength, y: p0.y };
    return {
      minX: Math.min(p0.x, p1.x),
      minY: Math.min(p0.y, p1.y),
      maxX: Math.max(p0.x, p1.x),
      maxY: Math.max(p0.y, p1.y),
    };
  }
  return curveBounds(points);
}

/**
 * Shape-aware length enforcement.
 *   bezier → scale points around anchor via `enforceCurveLength`
 *   line   → place `p[1]` exactly `targetLength` away from `p[0]` along current direction
 *            (or vice-versa when `anchorIdx === 1`, so the dragged endpoint stays put)
 *   circle → no-op (radius is implicit)
 * Mutates `points` in place.
 */
export function enforceStripShape(
  shape: StripShapeType,
  points: StripPoint[],
  targetLength: number,
  anchorIdx: number | null,
): void {
  if (shape === 'bezier') {
    enforceCurveLength(points, targetLength, anchorIdx);
    return;
  }
  if (shape === 'circle') {
    return;
  }
  // line
  if (points.length < 2 || targetLength <= 0.001) return;
  // Anchor = the endpoint that should stay put. Default to vertex 0.
  const anchor = anchorIdx === 1 ? points[1]! : points[0]!;
  const moving = anchorIdx === 1 ? points[0]! : points[1]!;
  let dx = moving.x - anchor.x;
  let dy = moving.y - anchor.y;
  let len = Math.hypot(dx, dy);
  if (len < 0.0001) { dx = 1; dy = 0; len = 1; }
  moving.x = anchor.x + (dx / len) * targetLength;
  moving.y = anchor.y + (dy / len) * targetLength;
}

/** Arc-length lookup: returns the world position at distance `s` along the curve. */
export function pointAtArcLength(sampled: SampledCurve, s: number): StripPoint {
  if (sampled.points.length === 0) return { x: 0, y: 0 };
  if (s <= 0) return { ...sampled.points[0]! };
  if (s >= sampled.totalLength) return { ...sampled.points[sampled.points.length - 1]! };
  // Binary search for the right interval.
  let lo = 0, hi = sampled.cumulative.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (sampled.cumulative[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const s0 = sampled.cumulative[lo]!;
  const s1 = sampled.cumulative[hi]!;
  const t = (s - s0) / Math.max(s1 - s0, 0.0001);
  const a = sampled.points[lo]!;
  const b = sampled.points[hi]!;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// ─── Length enforcement (the lock) ────────────────────────────────────────────

/**
 * Scales every vertex EXCEPT `anchorIdx` around the anchor by a uniform factor
 * so the resulting Bézier curve's arc length equals `targetLength`.
 *
 * Bézier curves are affine-invariant, but here we scale only a subset of the
 * control points, so length doesn't scale exactly with the factor — hence the
 * fixed-point iteration. Converges in 2–4 iterations to within ~0.1% for
 * typical strip shapes.
 *
 * If `anchorIdx` is null, all points are scaled around the polyline centroid
 * — used for insert/delete/body operations where no specific vertex is "held".
 *
 * MUTATES the points in place.
 */
export function enforceCurveLength(
  points: StripPoint[],
  targetLength: number,
  anchorIdx: number | null,
  opts: { maxIter?: number; tolerance?: number } = {},
): void {
  if (points.length < 2 || targetLength <= 0.001) return;
  const maxIter = opts.maxIter ?? 4;
  const tolerance = opts.tolerance ?? 0.001; // relative

  const pivot = anchorIdx != null && points[anchorIdx]
    ? { x: points[anchorIdx]!.x, y: points[anchorIdx]!.y }
    : centroidOf(points);

  for (let iter = 0; iter < maxIter; iter++) {
    const current = curveLength(points);
    if (current < 0.0001) break;
    const error = Math.abs(current - targetLength) / targetLength;
    if (error < tolerance) break;
    const factor = targetLength / current;
    for (let i = 0; i < points.length; i++) {
      if (i === anchorIdx) continue;
      const p = points[i]!;
      p.x = pivot.x + (p.x - pivot.x) * factor;
      p.y = pivot.y + (p.y - pivot.y) * factor;
    }
  }
}

function centroidOf(points: StripPoint[]): StripPoint {
  let sx = 0, sy = 0;
  for (const p of points) { sx += p.x; sy += p.y; }
  return { x: sx / points.length, y: sy / points.length };
}

// ─── AABB ─────────────────────────────────────────────────────────────────────

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number; }

/** AABB of the actual curve (samples Béziers — accurate for handle-overshooting splines). */
export function curveBounds(points: StripPoint[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const beziers = catmullRomBeziers(points);
  if (beziers.length === 0) {
    for (const p of points) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
  }
  // Sample each bezier at ARC_SAMPLES — cheap and gives accurate AABB.
  for (const b of beziers) {
    for (let i = 0; i <= ARC_SAMPLES; i++) {
      const p = bezierPoint(b, i / ARC_SAMPLES);
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, minY, maxX, maxY };
}

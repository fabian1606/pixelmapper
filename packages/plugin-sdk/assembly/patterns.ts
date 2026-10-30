/**
 * Spatial pattern helpers: aspect-correct distances, nearest-point lookups,
 * symmetry and soft pulses. All functions are pure and deterministic (f32).
 * Time-based helpers (easing, crossings, envelopes) live in `patterns-time.ts`.
 *
 * Coordinates (ABI 1.3): `Sample.x/y` (and `point` params, canvas handles,
 * the Spatial 2D handle) are *world* coordinates with one unit on both axes,
 * so distances between them are already isotropic: pass `aspect` = 1
 * (`dist2(s.x, s.y, px, py, 1.0)`). `Sample.u/v` are *room* coordinates (the
 * rig's bounding box stretched to 0–1 per axis); for those pass
 * `ctx.worldAspect` so circles stay circles (`dist2(s.u, s.v, cu, cv,
 * ctx.worldAspect)`, in units of the room depth). Every distance helper
 * takes that `aspect`.
 */
import { fract, smoothstep } from "./math";

/** Maximum number of points `minDistToPoints` / `nearestPointIndex` consider. */
export const MAX_PATTERN_POINTS: i32 = 8;

/** Distance returned by `minDistToPoints` when there is no point. */
export const NO_DISTANCE: f32 = 1e9;

// ── Distances ────────────────────────────────

/**
 * 2D Euclidean distance from (x, y) to (px, py) with the x difference
 * multiplied by `aspect`.
 *
 * World coordinates (`Sample.x/y`, `point` params) are already isotropic:
 * pass `aspect` = 1. Room coordinates (`Sample.u/v`) need `aspect` =
 * `ctx.worldAspect` (room width / room depth); the result is then in units
 * of the room depth.
 *
 * ```ts
 * // ring of radius 0.3 around a point param (world space)
 * const d = dist2(s.x, s.y, this.params.get(0), this.params.get(1), 1.0);
 * out.setScalar(pulse(d, 0.3, 0.1, 1.0));
 * // ring around the room center, whatever the rig's proportions
 * const r = dist2(s.u, s.v, 0.5, 0.5, ctx.worldAspect);
 * ```
 */
export function dist2(x: f32, y: f32, px: f32, py: f32, aspect: f32): f32 {
  const dx = (x - px) * aspect;
  const dy = y - py;
  return Mathf.sqrt(dx * dx + dy * dy);
}

/**
 * 3D Euclidean distance like `dist2`, plus a z term multiplied by `zScale`
 * (e.g. room height / room depth; 0 ignores z).
 */
export function dist3(x: f32, y: f32, z: f32, px: f32, py: f32, pz: f32, aspect: f32, zScale: f32): f32 {
  const dx = (x - px) * aspect;
  const dy = y - py;
  const dz = (z - pz) * zScale;
  return Mathf.sqrt(dx * dx + dy * dy + dz * dz);
}

// ── Nearest point ────────────────────────────

/** Number of usable points: `count` clamped to 0..8 and to `pts.length / 2`. */
@inline function pointCount(pts: StaticArray<f32>, count: i32): i32 {
  let n = count < 0 ? 0 : count;
  if (n > MAX_PATTERN_POINTS) n = MAX_PATTERN_POINTS;
  const cap = pts.length >> 1;
  return n > cap ? cap : n;
}

/**
 * Smallest `dist2` from (x, y) to up to 8 points stored interleaved in
 * `pts` as [x0, y0, x1, y1, …]. `count` is clamped to 0..8 and to
 * `pts.length / 2`; with no point it returns `NO_DISTANCE` (1e9).
 *
 * AssemblyScript has no closures, rest args or union types, so points are
 * passed as a flat array. Allocate the array ONCE (field initializer or in
 * `prepare`) and only overwrite its values; allocating per sample is slow.
 *
 * ```ts
 * class Blobs extends Modifier {
 *   pts: StaticArray<f32> = new StaticArray<f32>(16);
 *   prepare(p: Params): void { for (let i = 0; i < 16; i++) this.pts[i] = p.get(i); }
 *   render(ctx: Frame, s: Sample, out: Out): void {
 *     const d = minDistToPoints(s.x, s.y, 1.0, this.pts, 8);
 *     out.setScalar(pulse(d, 0.0, 0.4, 1.0));
 *   }
 * }
 * ```
 */
export function minDistToPoints(x: f32, y: f32, aspect: f32, pts: StaticArray<f32>, count: i32): f32 {
  const n = pointCount(pts, count);
  let best: f32 = NO_DISTANCE;
  for (let i = 0; i < n; i++) {
    const d = dist2(x, y, unchecked(pts[i << 1]), unchecked(pts[(i << 1) + 1]), aspect);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Index (0..count−1) of the point nearest to (x, y); same arguments as
 * `minDistToPoints`. Returns −1 when there is no point; ties pick the lower
 * index. Useful for Voronoi-style cells (color by index).
 */
export function nearestPointIndex(x: f32, y: f32, aspect: f32, pts: StaticArray<f32>, count: i32): i32 {
  const n = pointCount(pts, count);
  let best: f32 = NO_DISTANCE;
  let idx: i32 = -1;
  for (let i = 0; i < n; i++) {
    const d = dist2(x, y, unchecked(pts[i << 1]), unchecked(pts[(i << 1) + 1]), aspect);
    if (idx < 0 || d < best) {
      best = d;
      idx = i;
    }
  }
  return idx;
}

// ── Shaping ──────────────────────────────────

/**
 * Triangle wave 0 → 1 → 0 with period 1: 0 at integer `t`, 1 at `t` + 0.5.
 * `t` is in unwrapped cycles (e.g. `ctx.timePhase`); negatives work too.
 */
export function pingPong(t: f32): f32 {
  return 1.0 - Mathf.abs(2.0 * fract(t) - 1.0);
}

/**
 * Mirrors `x` at `axis`: the distance |x − axis| from the mirror axis.
 * Anything driven by `mirror(s.x, 0.5)` is symmetric around the room's
 * center line (0 on the axis, 0.5 at both walls).
 */
@inline export function mirror(x: f32, axis: f32): f32 {
  return Mathf.abs(x - axis);
}

/**
 * A pulse (band) over a distance or position `d`: 1 at `d` == `center`,
 * falling to 0 where |d − center| ≥ `width` / 2.
 *
 * `softness` ∈ [0, 1]: 0 = hard edge (1 inside, 0 outside), 1 = smoothstep
 * falloff across the whole half-width; in between, the inner part stays at 1
 * and only the outer `softness` fraction fades. `width` ≤ 0 → always 0.
 *
 * ```ts
 * // a soft ring expanding from the center once per cycle
 * const d = dist2(s.x, s.y, 0.5, 0.5, aspect);
 * out.setScalar(pulse(d, fract(ctx.timePhase), 0.15, 0.6));
 * ```
 */
export function pulse(d: f32, center: f32, width: f32, softness: f32): f32 {
  if (width <= 0.0) return 0.0;
  const half = width * 0.5;
  const dd = Mathf.abs(d - center);
  if (dd >= half) return 0.0;
  const soft = softness < 0.0 ? <f32>0.0 : softness > 1.0 ? <f32>1.0 : softness;
  const inner = half * (1.0 - soft);
  if (dd <= inner) return 1.0;
  return 1.0 - smoothstep((dd - inner) / (half - inner));
}

/**
 * Curve shape registry and curve evaluation (plan M1.2). Isomorphic, no DOM;
 * exported as `@pixelmapper/plugin-toolchain/curve-shapes`.
 *
 * Built-in shapes (plan §3.1) are registered on import; extensions add more
 * through `contributes.curveShapes` (the app registers them on activation).
 */
import {
  isFreeCurve,
  isShapeCurve,
  type CurveDomain,
  type CurvePointV2,
  type CurveValue,
  type ShapeContext,
  type ShapeDef,
} from '@pixelmapper/extension-api';
import { evaluatePoints } from './curve-points';

export { evaluatePoints, inHandle, isLegacyPoints, outHandle } from './curve-points';
import { PROFILE_SHAPES } from './shapes/profile';
import { MOTION_SHAPES } from './shapes/motion';
import { toPointsBySampling } from './shapes/sampling';

/** Number of f32 slots a curve param occupies. */
export const CURVE_LUT_SIZE = 128;

// ── Registry ─────────────────────────────────────

const shapes = new Map<string, ShapeDef>();

/** Registers (or replaces) a shape. Returns a disposer. */
export function registerShape(def: ShapeDef): () => void {
  shapes.set(def.id, def);
  return () => {
    if (shapes.get(def.id) === def) shapes.delete(def.id);
  };
}

/** A registered shape by id. */
export function getShape(id: string): ShapeDef | undefined {
  return shapes.get(id);
}

/** All registered shapes (built-ins first, then registration order). */
export function listShapes(): ShapeDef[] {
  return [...shapes.values()];
}

/** Ids of the built-in shapes (always registered). */
export const BUILTIN_SHAPE_IDS: readonly string[] = [...PROFILE_SHAPES, ...MOTION_SHAPES].map(s => s.id);

for (const s of [...PROFILE_SHAPES, ...MOTION_SHAPES]) registerShape(s);

// ── Args ─────────────────────────────────────────

/** Args of a shape with defaults filled in and values clamped to min/max. */
export function clampArgs(def: ShapeDef, args: Record<string, number> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of def.args) {
    const v = Number(args[a.key]);
    out[a.key] = Number.isFinite(v) ? Math.max(a.min, Math.min(a.max, v)) : a.default;
  }
  return out;
}

/** Default args of a shape. */
export function defaultArgs(def: ShapeDef): Record<string, number> {
  return Object.fromEntries(def.args.map(a => [a.key, a.default]));
}

// ── Evaluation ───────────────────────────────────

/** Domain x of normalized t ∈ [0, 1]. */
export const domainX = (domain: CurveDomain, t: number) => (domain === 'signed' ? t * 2 - 1 : t);

/** Normalized t ∈ [0, 1] of a domain x. */
export const domainT = (domain: CurveDomain, x: number) => (domain === 'signed' ? (x + 1) / 2 : x);

/** Unknown shape ids warned about once. */
const warned = new Set<string>();

/**
 * Value of a curve at `x` (domain units) in [0, 1]. Programmatic values use
 * their registered shape (unknown ids evaluate to 0); free and legacy points
 * are normalized over the domain.
 */
export function evaluateCurve(value: CurveValue, x: number, ctx: ShapeContext = { ticks: 0 }, domain: CurveDomain = 'cycle'): number {
  if (isShapeCurve(value)) {
    const def = shapes.get(value.shape);
    if (!def) {
      if (!warned.has(value.shape)) {
        warned.add(value.shape);
        console.warn(`[curve-shapes] unknown shape "${value.shape}" (extension not installed?)`);
      }
      return 0;
    }
    const v = def.evaluate(x, clampArgs(def, value.args), ctx);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  }
  const points: readonly CurvePointV2[] = isFreeCurve(value) ? value.points : Array.isArray(value) ? value : [];
  return evaluatePoints(points, domainT(domain, x));
}

/**
 * Samples a curve into a LUT of `size` values over its domain
 * (`cycle`: x = i/(size−1); `signed`: x = −1 + 2i/(size−1)), clamped to [0, 1].
 */
export function sampleCurveLut(value: CurveValue, size = CURVE_LUT_SIZE, ctx: ShapeContext = { ticks: 0 }, domain: CurveDomain = 'cycle'): Float32Array {
  const lut = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const t = size === 1 ? 0 : i / (size - 1);
    lut[i] = Math.min(1, evaluateCurve(value, domainX(domain, t), ctx, domain));
  }
  return lut;
}

/**
 * Free points of a programmatic value (the shape's `toPoints`, else dense
 * sampling simplified to linear/step points). Points are normalized over the
 * domain.
 */
export function shapeToPoints(value: CurveValue, ctx: ShapeContext = { ticks: 0 }, domain: CurveDomain = 'cycle'): CurvePointV2[] {
  if (isFreeCurve(value)) return value.points.map(p => ({ ...p }));
  // Legacy points stay kind-less, so they keep their Catmull-Rom look.
  if (Array.isArray(value)) return value.map(p => ({ ...p }));
  const def = shapes.get(value.shape);
  if (def?.toPoints) return def.toPoints(clampArgs(def, value.args), ctx);
  return toPointsBySampling(t => evaluateCurve(value, domainX(domain, t), ctx, domain));
}

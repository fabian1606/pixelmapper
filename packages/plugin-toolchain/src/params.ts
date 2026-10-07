/**
 * Param wire encoding (ADR §6.2). Lightweight: no compiler dependency, so the
 * app imports it via `@pixelmapper/plugin-toolchain/params`.
 *
 * The params block is the concatenation of every param's f32 slots in
 * manifest order: number/int/angle 1, bool 1 (0/1), enum 1 (index),
 * color 3 (r,g,b), point 2 (x,y), curve 128 (LUT of the spline, 0–1).
 */
import {
  PARAM_WIRE_SLOTS,
  type CurvePoint,
  type ParamDef,
  type ParamSchema,
  type ParamValue,
  type RgbColor,
  type Vec2,
} from '@pixelmapper/extension-api';

/** Number of f32 slots a curve param occupies. */
export const CURVE_LUT_SIZE = 128;

/** Catmull-Rom evaluation between p1 and p2 with p0/p3 as outer knots. */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/**
 * Samples the spline through `points` (sorted by x) at `x` ∈ [0, 1].
 * Returns `fallback` for an empty list; never negative.
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
  const t = segW < 1e-9 ? 0 : Math.max(0, Math.min(1, (cx - p1.x) / segW));
  const p0y = i > 1 ? points[i - 2]!.y : p1.y;
  const p3y = i < n - 1 ? points[i + 1]!.y : p2.y;
  return Math.max(0, catmullRom(p0y, p1.y, p2.y, p3y, t));
}

/** Samples a curve into a LUT of `size` values clamped to [0, 1]. */
export function sampleCurveLut(points: readonly CurvePoint[], size = CURVE_LUT_SIZE): Float32Array {
  const lut = new Float32Array(size);
  for (let i = 0; i < size; i++) lut[i] = Math.min(1, sampleCurve(points, size === 1 ? 0 : i / (size - 1)));
  return lut;
}

/** Total f32 slots of a schema. */
export function paramSlotCount(schema: ParamSchema): number {
  return schema.reduce((n, p) => n + PARAM_WIRE_SLOTS[p.type], 0);
}

/** Default values of a schema. */
export function defaultParams(schema: ParamSchema): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of schema) out[p.key] = structuredClone(p.default) as ParamValue;
  return out;
}

/** Writes one param's slots at `offset`; returns the next offset. */
function writeParam(buf: Float32Array, offset: number, def: ParamDef, value: ParamValue | undefined): number {
  const v = value ?? def.default;
  switch (def.type) {
    case 'number':
    case 'int':
    case 'angle':
      buf[offset] = Number(v);
      return offset + 1;
    case 'bool':
      buf[offset] = v ? 1 : 0;
      return offset + 1;
    case 'enum': {
      const idx = def.options.indexOf(String(v));
      buf[offset] = idx >= 0 ? idx : Math.max(0, def.options.indexOf(def.default));
      return offset + 1;
    }
    case 'color': {
      const c = v as RgbColor;
      buf[offset] = c.r;
      buf[offset + 1] = c.g;
      buf[offset + 2] = c.b;
      return offset + 3;
    }
    case 'point': {
      const p = v as Vec2;
      buf[offset] = p.x;
      buf[offset + 1] = p.y;
      return offset + 2;
    }
    case 'curve':
      buf.set(sampleCurveLut(v as CurvePoint[]), offset);
      return offset + CURVE_LUT_SIZE;
  }
}

/** Encodes param values into the f32 params block (missing values use defaults). */
export function encodeParams(schema: ParamSchema, values: Record<string, ParamValue> = {}): Float32Array {
  const buf = new Float32Array(paramSlotCount(schema));
  let offset = 0;
  for (const def of schema) offset = writeParam(buf, offset, def, values[def.key]);
  return buf;
}

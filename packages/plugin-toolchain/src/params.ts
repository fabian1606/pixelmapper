/**
 * Param wire encoding (ADR §6.2). Lightweight: no compiler dependency, so the
 * app imports it via `@pixelmapper/plugin-toolchain/params`.
 *
 * The params block is the concatenation of every param's f32 slots in
 * manifest order: number/int/angle 1, bool 1 (0/1), enum 1 (index),
 * color 3 (r,g,b), point 2 (x,y), curve 128 (LUT over the curve's domain, 0–1),
 * gradient 33 (count, (pos,r,g,b)×8), steps 18 (groups, steps, mask[16]),
 * trigger 4 (pressed, pressedAt, releasedAt, clicks; times in engine-clock ms).
 */
import {
  PARAM_WIRE_SLOTS,
  type CurveValue,
  type GradientValue,
  type ParamDef,
  type StepsValue,
  type TriggerValue,
  type ParamSchema,
  type ParamValue,
  type RgbColor,
  type Vec2,
} from '@pixelmapper/extension-api';

import { CURVE_LUT_SIZE, sampleCurveLut } from './curve-shapes';
import { writeGradient, writeSteps } from './param-structs';
import { writeTrigger } from './trigger';

export { CURVE_LUT_SIZE, evaluateCurve, sampleCurveLut } from './curve-shapes';
export { evaluatePoints, sampleCurve } from './curve-points';
export { checkTrigger, DEFAULT_MULTI_CLICK_MS, multiClickMsOf, TRIGGER_IDLE, TRIGGER_NEVER_MS, triggerEdge, writeTrigger } from './trigger';

/** Context of an encoding (plan §1.5). */
export interface EncodeContext {
  /** Rank count of the instance; shapes with "auto" args resolve one step per rank. */
  ticks?: number;
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
function writeParam(buf: Float32Array, offset: number, def: ParamDef, value: ParamValue | undefined, ctx: EncodeContext): number {
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
    case 'gradient':
      writeGradient(buf, offset, v as GradientValue);
      return offset + PARAM_WIRE_SLOTS.gradient;
    case 'steps':
      writeSteps(buf, offset, v as StepsValue);
      return offset + PARAM_WIRE_SLOTS.steps;
    case 'trigger':
      writeTrigger(buf, offset, v as TriggerValue);
      return offset + PARAM_WIRE_SLOTS.trigger;
    case 'curve':
      // LUT over the param's domain (cycle: x = i/127, signed: x = −1 + 2i/127), clamped to 0–1.
      buf.set(sampleCurveLut(v as CurveValue, CURVE_LUT_SIZE, { ticks: ctx.ticks ?? 0 }, def.domain ?? 'cycle'), offset);
      return offset + CURVE_LUT_SIZE;
  }
}

/**
 * Encodes param values into the f32 params block (missing values use
 * defaults). `ctx.ticks` is the instance's rank count (shape "auto" args).
 */
export function encodeParams(schema: ParamSchema, values: Record<string, ParamValue> = {}, ctx: EncodeContext = {}): Float32Array {
  const buf = new Float32Array(paramSlotCount(schema));
  let offset = 0;
  for (const def of schema) offset = writeParam(buf, offset, def, values[def.key], ctx);
  return buf;
}

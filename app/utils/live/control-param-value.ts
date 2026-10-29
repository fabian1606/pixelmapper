/**
 * Which plugin param types a live control can drive through an `effect-param`
 * mapping, and the param value a control input produces. Pure (no stores) so
 * the runtime dispatcher (`composables/live-ops/apply-mapping.ts`), the
 * mapping editor and the `live.*` operation verify share one table.
 *
 * - slider / fader: a 0–1 value → number/int (min–max), bool (≥ 0.5), trigger
 *   (pressed above half), plus the built-in strength / speed / fanning.
 * - button / pad: press/release → bool (toggle or momentary per the mapping's
 *   `behavior`) and trigger (press/release edges, see `trigger-param.ts`).
 * - xy pad: x/y 0–1 → point `{ x, y }`.
 */
import type { ParamValue, Vec2 } from '@pixelmapper/extension-api';
import type { ButtonBehavior } from './types';

// ── Capabilities ────────────────────────────────

/** Control kinds that can drive effect params. */
export type ParamControlKind = 'button' | 'slider' | 'xy';

/** Plugin param types each control kind drives at runtime. */
export const CONTROL_PARAM_TYPES: Record<ParamControlKind, readonly string[]> = {
  button: ['bool', 'trigger'],
  slider: ['number', 'int', 'bool', 'trigger'],
  xy: ['point'],
};

/** Control kinds that drive the built-in modifier keys (strength / speed / fanning). */
export const BUILTIN_PARAM_CONTROLS: readonly ParamControlKind[] = ['slider'];

/** Param types any control can drive (union of {@link CONTROL_PARAM_TYPES}). */
export const DRIVABLE_PARAM_TYPES: ReadonlySet<string> = new Set(Object.values(CONTROL_PARAM_TYPES).flat());

/** Default button behavior for bool params: each press toggles the value. */
export const DEFAULT_BUTTON_BEHAVIOR: ButtonBehavior = 'latch';

/**
 * Param type of a stored value when the plugin manifest is unknown
 * (numbers → number, booleans → bool, `{ x, y }` → point), else null.
 */
export function paramTypeOfValue(v: unknown): string | null {
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'bool';
  if (isPoint(v)) return 'point';
  return null;
}

// ── Values ──────────────────────────────────────

/** Minimal param definition the value mapping needs. */
export interface ControlParamDef {
  type: string;
  min?: number;
  max?: number;
}

/** One control input: press state plus the continuous value(s), if any. */
export interface ControlInput {
  /** Pressed (buttons); sliders and xy pads pass true. */
  active: boolean;
  /** 0–1 value of a slider, or the x axis of an xy pad. */
  value?: number;
  /** 0–1 y axis of an xy pad. */
  value2?: number;
  /** Button behavior for bool params (default {@link DEFAULT_BUTTON_BEHAVIOR}). */
  behavior?: ButtonBehavior;
}

/** `{ x, y }` with finite numbers. */
function isPoint(v: unknown): v is Vec2 {
  return !!v && typeof v === 'object' && Number.isFinite((v as Vec2).x) && Number.isFinite((v as Vec2).y);
}

/** Clamps to 0–1. */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * The value a control input writes into a param of type `def.type`, or
 * undefined when the input does not change it (unsupported type, a button
 * release on a toggling bool, a slider on a point param, …). `current` is
 * the param's current value (needed to toggle). Trigger params are handled
 * separately (edge stamps, `trigger-param.ts`).
 */
export function controlParamValue(def: ControlParamDef | undefined, current: unknown, input: ControlInput): ParamValue | undefined {
  if (!def) return undefined;
  const { active, value, value2 } = input;
  switch (def.type) {
    case 'number':
    case 'int': {
      if (value === undefined || def.min === undefined || def.max === undefined) return undefined;
      const v = def.min + clamp01(value) * (def.max - def.min);
      return def.type === 'int' ? Math.round(v) : v;
    }
    case 'bool': {
      // Slider: switches at half.
      if (value !== undefined) return value >= 0.5;
      // Button, momentary: on while held.
      if ((input.behavior ?? DEFAULT_BUTTON_BEHAVIOR) === 'hold') return active;
      // Button, toggle: each press flips; release changes nothing.
      return active ? !current : undefined;
    }
    case 'point':
      // Only a 2D control (xy pad) provides both axes.
      if (value === undefined || value2 === undefined) return undefined;
      return { x: clamp01(value), y: clamp01(value2) };
    default:
      return undefined;
  }
}

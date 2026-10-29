/**
 * Param schema language (ADR §6.2).
 *
 * Shared by content-plugin manifests (`params`) and fixture-kind
 * `configSchema`. The host renders a schema with the `pm.*` inputs
 * (`ParamForm`); each param type has a default input that `ui` may override.
 */
import type { PmInputName } from './replaceables';
import type { RgbColor, Vec2 } from './model';
import type { CurveAxis, CurveDomain, CurveRange, CurveValue } from './curves';
import type { DistributionPatch } from './distribution';

/** One control point of a curve param. Both axes are normalized 0–1. */
export interface CurvePoint {
  /** Position in the cycle, 0–1, monotonically increasing. */
  x: number;
  /** Value at that position, 0–1. */
  y: number;
}

/** Fields shared by every param definition. */
export interface ParamBase<T extends string, V> {
  /** Param type discriminator. */
  type: T;
  /** Unique camelCase key; becomes the key in `params` records. */
  key: string;
  /** Human-readable label shown next to the input. */
  label: string;
  /** Default value used for new instances. */
  default: V;
  /** Optional longer description (shown as tooltip; read by AI). */
  description?: string;
  /** Override the default `pm.*` input used to render this param. */
  ui?: PmInputName;
  /** Visual group name; params with the same group share a section. */
  group?: string;
  /**
   * Where the param renders (plan §1.4): `primary` = card body (default),
   * `advanced` = under "More", `hidden` = never (recipes and editors set it).
   */
  tier?: 'primary' | 'advanced' | 'hidden';
  /** Show only when every condition holds (other param keys, `distribution.mode`). */
  when?: ParamCondition;
}

/** Equality conditions on other param keys and `distribution.mode`; arrays mean "one of". */
export type ParamCondition = Record<string, string | number | boolean | (string | number | boolean)[]>;

/** Continuous number. Wire: 1 f32. Default input: `pm.fader`. */
export interface NumberParam extends ParamBase<'number', number> {
  min: number;
  max: number;
  step?: number;
  /** Display unit, e.g. `'%'`, `'Hz'`, `'m'`. */
  unit?: string;
}

/** Integer. Wire: 1 f32. Default input: `pm.numberInput`. */
export interface IntParam extends ParamBase<'int', number> {
  min: number;
  max: number;
}

/** Boolean. Wire: 1 f32 (0/1). Default input: `pm.toggle`. */
export type BoolParam = ParamBase<'bool', boolean>;

/** One of a fixed list of strings. Wire: 1 f32 (index). Default input: `pm.select`. */
export interface EnumParam extends ParamBase<'enum', string> {
  options: string[];
  /** Optional display labels, parallel to `options`. */
  optionLabels?: string[];
  /**
   * Distribution an option needs (option → patch). Picking the option in the
   * card also applies the patch, e.g. Color Shift's "Alternate" switches the
   * spread to Fixture by fixture because it alternates along the numbers.
   */
  optionDistribution?: Record<string, DistributionPatch>;
}

/** Linear RGB color. Wire: 3 f32. Default input: `pm.colorInput`. */
export type ColorParam = ParamBase<'color', RgbColor>;

/** Angle in radians. Wire: 1 f32. Default input: `pm.angle`. */
export type AngleParam = ParamBase<'angle', number>;

/** Normalized 2D point. Wire: 2 f32. Default input: `pm.xyInput`. */
export type PointParam = ParamBase<'point', Vec2>;

/**
 * Curve (v2, plan M1.1). Wire: 128 f32 host-sampled LUT over `domain`.
 * Default input: `pm.curve`.
 */
export interface CurveParam extends ParamBase<'curve', CurveValue> {
  /** Offered shapes (registry ids) in UI order; omitted = free editing only. */
  shapes?: string[];
  /** Allow converting to free points. Default true. */
  allowFree?: boolean;
  /** LUT x-range: `cycle` = [0, 1] (default), `signed` = [−1, 1]. */
  domain?: CurveDomain;
  /** Tick/snap context in the editor. Default `none`. */
  axis?: CurveAxis;
  /** y display; the wire stays 0–1. Default `unipolar`. */
  range?: CurveRange;
}

/** One color stop of a gradient (position 0–1). */
export interface GradientStop {
  pos: number;
  color: RgbColor;
}

/** A gradient: 1–8 stops sorted by `pos`. */
export interface GradientValue {
  stops: GradientStop[];
}

/** Color gradient. Wire: 33 f32 (`count, (pos, r, g, b) × 8`). Default input: `pm.gradient`. */
export type GradientParam = ParamBase<'gradient', GradientValue>;

/** A step grid: `cells[step][group]` on/off; 1–8 groups, 1–16 steps. */
export interface StepsValue {
  groups: number;
  steps: number;
  cells: boolean[][];
}

/**
 * Step grid. Wire: 18 f32 (`groups, steps, mask[16]`, `mask[s]` bit `g` =
 * group `g` on in step `s`). Default input: `pm.steps`.
 */
export type StepsParam = ParamBase<'steps', StepsValue>;

/**
 * State of a momentary `trigger` param (ABI 1.3). The host records the
 * edges; times are in engine-clock ms (the same clock as `Frame.timeMs`).
 */
export interface TriggerValue {
  /** True while the button is held. */
  pressed: boolean;
  /** Engine-clock ms of the last press; absent = never pressed. */
  pressedAt?: number;
  /** Engine-clock ms of the last release; absent = never released. */
  releasedAt?: number;
  /** Presses in the current multi-click burst (1 = single, 2 = double, …; 0 = never pressed). */
  clicks?: number;
}

/**
 * Momentary input (hold / release / double-click), e.g. "hold = blackout,
 * release = shock wave, double-click = flash". Not saved as a look: the host
 * updates it on press/release (card button or a live `button` widget mapped
 * via `effect-param`) without an undo step. Manifest default: `{ "pressed": false }`.
 *
 * Wire: 4 f32 — `pressed (0/1), pressedAt, releasedAt, clicks` with the
 * times in engine-clock ms (−1e9 = never). `render` stays pure: the SDK's
 * `triggerMsSincePress(params, slot, ctx)` etc. subtract them from
 * `ctx.timeMs`. Default input: `pm.button`.
 */
export interface TriggerParam extends ParamBase<'trigger', TriggerValue> {
  /** Max ms between a release and the next press that still counts as a multi-click. Default 350. */
  multiClickMs?: number;
}

/** Any param definition. */
export type ParamDef =
  | NumberParam
  | IntParam
  | BoolParam
  | EnumParam
  | ColorParam
  | AngleParam
  | PointParam
  | CurveParam
  | GradientParam
  | StepsParam
  | TriggerParam;

/** Param type discriminator. */
export type ParamType = ParamDef['type'];

/** An ordered list of param definitions. Order defines the wire layout. */
export type ParamSchema = ParamDef[];

/** Runtime value of any param. */
export type ParamValue = number | boolean | string | RgbColor | Vec2 | CurveValue | GradientValue | StepsValue | TriggerValue;

/** Number of f32 slots each param type occupies in the params block. */
export const PARAM_WIRE_SLOTS: Readonly<Record<ParamType, number>> = {
  number: 1,
  int: 1,
  bool: 1,
  enum: 1,
  color: 3,
  angle: 1,
  point: 2,
  curve: 128,
  gradient: 33,
  steps: 18,
  trigger: 4,
};

/** Default `pm.*` input per param type (D13). */
export const PARAM_DEFAULT_INPUT: Readonly<Record<ParamType, PmInputName>> = {
  number: 'pm.fader',
  int: 'pm.numberInput',
  bool: 'pm.toggle',
  enum: 'pm.select',
  color: 'pm.colorInput',
  angle: 'pm.angle',
  point: 'pm.xyInput',
  curve: 'pm.curve',
  gradient: 'pm.gradient',
  steps: 'pm.steps',
  trigger: 'pm.button',
};

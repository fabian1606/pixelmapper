/**
 * Shared domain vocabulary of the extension API.
 *
 * These types mirror the core model (`app/utils/engine/types.ts`,
 * `app/utils/engine/core/*`) but are declared here so the API package has no
 * dependency on host internals. They are part of the versioned API contract.
 */

/** Identifier of a fixture. Legacy projects use numbers, new ones strings. */
export type FixtureId = string | number;

/** Identifier of any scene node (fixture or group). */
export type SceneNodeId = string | number;

/**
 * OFL-aligned DMX channel type. Mirrors `ChannelType` in the core.
 */
export type ChannelType =
  // Color
  | 'RED' | 'GREEN' | 'BLUE' | 'WHITE' | 'WARM_WHITE' | 'COOL_WHITE' | 'AMBER' | 'UV'
  | 'CYAN' | 'MAGENTA' | 'YELLOW' | 'LIME' | 'INDIGO'
  | 'COLOR_WHEEL' | 'COLOR_PRESET' | 'COLOR_TEMPERATURE'
  // Intensity
  | 'DIMMER'
  // Position
  | 'PAN' | 'PAN_CONTINUOUS' | 'TILT' | 'TILT_CONTINUOUS' | 'PANTILT_SPEED'
  // Beam
  | 'STROBE' | 'STROBE_SPEED' | 'STROBE_DURATION'
  | 'ZOOM' | 'FOCUS' | 'IRIS' | 'IRIS_EFFECT' | 'FROST' | 'FROST_EFFECT' | 'BEAM_ANGLE' | 'BEAM_POSITION'
  // Shaping (Gobo, Prism, Blades)
  | 'GOBO_WHEEL' | 'GOBO_SPIN' | 'PRISM' | 'PRISM_ROTATION' | 'BLADE' | 'BLADE_ROTATION' | 'BLADE_SYSTEM_ROTATION'
  // Effects & Control
  | 'EFFECT' | 'EFFECT_SPEED' | 'EFFECT_DURATION' | 'EFFECT_PARAMETER' | 'SOUND_SENSITIVITY'
  | 'ROTATION' | 'SPEED' | 'TIME'
  // Other
  | 'FOG' | 'FOG_OUTPUT' | 'FOG_TYPE' | 'MAINTENANCE' | 'GENERIC' | 'NO_FUNCTION' | 'CUSTOM';

/**
 * How a channel contributes to the visual output.
 * - `COLOR`: a light color (red, green, …).
 * - `DIMMER`: scales all color channels.
 * - `COLOR_WHEEL`: selects a color (does not scale brightness).
 * - `SHUTTER`: gates the output (open / closed / strobe).
 * - `NONE`: no color contribution (pan, tilt, …).
 */
export type ChannelRole = 'COLOR' | 'DIMMER' | 'COLOR_WHEEL' | 'SHUTTER' | 'NONE';

/**
 * Typed value space a modifier or control operates in (ADR D4). The list is
 * fixed by the core; extensions cannot add signatures.
 * - `scalar`: one normalized channel value (arity 1).
 * - `rgb`: linear RGB, each 0–1 (arity 3).
 * - `panTilt`: normalized pan/tilt within the movement range (arity 2).
 */
export type Signature = 'scalar' | 'rgb' | 'panTilt';

/** Number of components per signature value. */
export const SIGNATURE_ARITY: Readonly<Record<Signature, number>> = {
  scalar: 1,
  rgb: 3,
  panTilt: 2,
};

/** A 2D point/vector. Units depend on context (documented at each use). */
export interface Vec2 {
  x: number;
  y: number;
}

/** Axis-aligned rectangle. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Linear RGB color with components in 0–1. */
export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** Timing mode of a speed setting. */
export type SpeedMode = 'time' | 'beat' | 'infinite';

/** Speed configuration (time-, beat- or un-synced). Mirrors the core type. */
export interface SpeedConfig {
  mode: SpeedMode;
  /** Cycle length in milliseconds (mode `time`). */
  timeMs: number;
  /** Cycle length in beats (mode `beat`), e.g. 0.25 for a 1/4 note. */
  beatValue: number;
  /** Phase offset in beats. */
  beatOffset: number;
}

/** Spatial phase distribution of a modifier across fixtures. */
export type EffectDirection = 'NONE' | 'LINEAR' | 'RADIAL' | 'SYMMETRICAL' | 'ANGULAR';

/** How a modifier output is combined with the base value. */
export type BlendMode = 'add' | 'override' | 'multiply' | 'max' | 'min';

/** Any JSON-serializable value. Used for persisted extension data. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

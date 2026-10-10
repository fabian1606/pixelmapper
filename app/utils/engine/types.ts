/**
 * Core engine model types.
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

export type SpeedMode = 'time' | 'beat' | 'infinite';

export interface SpeedConfig {
  mode: SpeedMode;
  timeMs: number;
  beatValue: number; // e.g., 0.25 for 1/4 note
  beatOffset: number; // Phase/time offset in beats (e.g. 0.25 for 1/4 beat shift)
}

export interface ChannelChaserConfig {
  /**
   * The programmed DMX step values for this channel.
   * A single-element array represents a static "scene" value.
   * Chaser engines interpolate across multiple steps.
   */
  stepValues: number[];
  stepsCount: number;
  activeEditStep: number;
  isPlaying: boolean;
  stepDuration: SpeedConfig;
  fadeDuration: SpeedConfig;
}

/** Former spatial direction (schema v2); only read by the v3 migration. */
export type EffectDirection = 'NONE' | 'LINEAR' | 'RADIAL' | 'SYMMETRICAL' | 'ANGULAR';

/**
 * Defines the direction and spread of a spatial effect in the Fixture Editor.
 * All values are normalized (0-1 relative to world width/height).
 */
export interface SpatialVector {
  /** Anchor/origin point of the vector (0-1 normalized) */
  originX: number;
  originY: number;
  /** Direction in radians. 0 = right (+X), π/2 = down (+Y). */
  angle: number;
  /** Length of the vector (0-1 normalized). 1.0 = full world-width span. */
  magnitude: number;
}

export type BlendMode = 'add' | 'override' | 'multiply' | 'max' | 'min';

/** Value space of a modifier (ADR D4): one channel, linear RGB, or pan/tilt. */
export type Signature = 'scalar' | 'rgb' | 'panTilt';

/** Distribution of an instance over fixtures (plan §1.1, ADR A20). */
export type {
  Distribution,
  DistributionPatch,
  DistributionMode,
  DistributionScope,
  GroupingKind,
} from '@pixelmapper/extension-api';

/** Value of one plugin param (see the param schema, ADR §6.2). */
export type ParamValue = import('@pixelmapper/extension-api').ParamValue;

/**
 * A modifier instance (ADR §6.3). The plugin (content hash) computes the
 * output; every other field is owned by the host. Plain JSON — persisted in
 * the project, snapshotted by presets and pinned modifiers, synced live.
 */
export interface ModifierInstance {
  id: string;
  /** Content hash of the plugin (`sha256:…`). */
  plugin: string;
  /** One of the plugin manifest's signatures. */
  signature: Signature;
  /**
   * Channel types the modifier applies to. For `scalar` these are the
   * rendered channels; for `rgb`/`panTilt` they only scope the UI category.
   */
  targetChannels: ChannelType[];
  /** Restricted fixtures; undefined = all. */
  targetFixtureIds?: (string | number)[];
  blendMode: BlendMode;
  /** 0–1. */
  strength: number;
  speed: SpeedConfig;
  /** How the instance spreads over fixtures (replaces direction/origin/angle/fanning/reverse). */
  distribution: import('@pixelmapper/extension-api').Distribution;
  /** Plugin params by key (defaults from the manifest). */
  params: Record<string, ParamValue>;
}

export type WaveformShape = 'sine' | 'square' | 'triangle' | 'sawtooth' | 'bounce' | 'ramp' | 'smooth';

export type NoiseType = 'white' | 'perlin' | 'step';
export type ChannelMode = 'linked' | 'independent';

export interface NoiseParams {
  noiseType: NoiseType;
  /** Spatial frequency for Perlin noise (0.1–10). Higher = faster change between fixtures. */
  scale: number;
  channelMode: ChannelMode;
  /** 0 = channels correlated (white output), 1 = fully decorrelated (colorful). Only active when channelMode='independent'. */
  colorVariation: number;
  /** Crossfade between consecutive random values as fraction of step duration (0 = hard snap, 1 = continuous). */
  fade: number;
  /** Only output noise above this level (0–1). Values below become 0 → sparkle/gate effect. */
  threshold: number;
}

export type SequencerPatternType = 'split' | 'checkerboard' | 'sections' | 'scatter' | 'flow';

export interface SequencerParams {
  patternType: SequencerPatternType;
  /** Pattern anchor in normalized world space (0–1). */
  originX: number;
  originY: number;
  /** Direction of pattern axis in radians. 0 = right (+X). */
  angle: number;
  /** Cell/band size relative to world width (0.01–1.0). */
  scale: number;
  /** Number of section bands (2–16, sections pattern only). */
  count: number;
  /** On-probability for scatter/flow pattern (0–1). */
  density: number;
  /** How much density shifts randomly per cycle (0–1, scatter only). */
  densityVariation: number;
  invert: boolean;
}

export interface WaveformShapeParams {
  /**
   * Normalized 0–1 parameter controlling the adjustable aspect of the shape.
   * - sine:     unused (strength is the only control)
   * - square:   dutyCycle (0.05–0.95, default 0.5)
   * - triangle: peak position (0.05–0.95, default 0.5)
   * - sawtooth: direction (< 0.5 = falling, ≥ 0.5 = rising)
   * - bounce:   bounce count mapped to 1–5 integer
   * - ramp:     softness (0 = sharp step, 1 = very smooth S-curve)
   */
  param: number;
  /** Where in the cycle the waveform starts (0–1, default 0). */
  start: number;
  /** Where in the cycle the waveform ends (0–1, default 1). */
  end: number;
  /** Hold value before the active zone [-1, 1]. If undefined, uses the shape's natural value at t=0. */
  startLevel?: number;
  /** Hold value after the active zone [-1, 1]. If undefined, uses the shape's natural value at t=1. */
  endLevel?: number;
}

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

export type EffectDirection = 'NONE' | 'LINEAR' | 'RADIAL' | 'SYMMETRICAL';

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

export interface EffectContext {
  /**
   * Continuous time value in milliseconds.
   */
  time: number;

  /**
   * The index of the fixture currently being rendered.
   */
  index: number;

  /**
   * The total numbers of fixtures in the engine.
   */
  fixtureCount: number;

  /**
   * The physical X position of the fixture in normalized world space (0.0 - 1.0).
   */
  x: number;

  /**
   * The physical Y position of the fixture in normalized world space (0.0 - 1.0).
   */
  y: number;
}

export interface Effect {
  /**
   * Unique identifier for the effect instance.
   */
  id: string;

  /**
   * The channel types this effect applies to (e.g., ['RED', 'DIMMER']).
   */
  targetChannels: ChannelType[];

  /**
   * Optional array of fixture IDs this effect should be restricted to.
   * If missing, applies to all fixtures.
   */
  targetFixtureIds?: (string | number)[];

  /**
   * The direction the effect propagates across the fixtures.
   */
  direction?: EffectDirection;

  /**
   * The X origin for spatial effects (normalized 0-1).
   */
  originX?: number;

  /**
   * The Y origin for spatial effects (normalized 0-1).
   */
  originY?: number;

  /**
   * The angle for spatial effects in radians.
   */
  angle?: number;

  /**
   * The strength (amplitude) of the effect to apply around the base value (usually 0 to 255).
   */
  strength: number;

  /**
   * Reverses the propagation direction of the effect.
   */
  reverse?: boolean;

  /**
   * Defines how much the phase is offset per fixture. If 0, all fixtures run in sync.
   */
  fanning: number;

  /**
   * Speed configuration for the effect.
   */
  speed: SpeedConfig;

  /**
   * The waveform shape to use. Defaults to 'sine' for backwards compatibility.
   */
  waveformShape?: WaveformShape;

  /**
   * Shape-specific parameter (normalized 0–1). See WaveformShapeParams for details.
   */
  waveformParams?: WaveformShapeParams;

  /**
   * Noise-specific parameters. Only present when the effect is a NoiseEffect.
   */
  noiseParams?: NoiseParams;

  /**
   * Sequencer-specific parameters. Only present when the effect is a SequencerEffect.
   */
  sequencerParams?: SequencerParams;

  /**
   * Called once per frame before rendering to accumulate state (e.g., phase based on speed and delta time).
   */
  update?(deltaTime: number, engine: any): void;

  /**
   * Renders the raw effect wave for a given context.
   * Expected to return a normalized shape value between -1 and 1.
   * @param context The current context the effect is being rendered for.
   */
  render(context: EffectContext): number;

  /**
   * Optional method to render a background CSS preview of the effect's spatial distribution.
   * Expected to return a style object mapping (e.g., { background: '...' }).
   */
  getPreviewCSS?(params: {
    worldWidth: number;
    worldHeight: number;
    camera: { x: number; y: number; scale: number };
    viewportWidth: number;
    viewportHeight: number;
  }): Record<string, string>;
}

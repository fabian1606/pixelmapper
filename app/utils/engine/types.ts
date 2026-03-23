export type ChannelType =
  // Color
  | 'RED' | 'GREEN' | 'BLUE' | 'WHITE' | 'WARM_WHITE' | 'COOL_WHITE' | 'AMBER' | 'UV'
  | 'CYAN' | 'MAGENTA' | 'YELLOW' | 'LIME' | 'INDIGO'
  | 'COLOR_WHEEL' | 'COLOR_PRESET' | 'COLOR_TEMPERATURE'
  // Intensity
  | 'DIMMER'
  // Position
  | 'PAN' | 'TILT' | 'PANTILT_SPEED'
  // Beam
  | 'STROBE' | 'STROBE_SPEED' | 'STROBE_DURATION'
  | 'ZOOM' | 'FOCUS' | 'IRIS' | 'FROST' | 'BEAM_ANGLE' | 'BEAM_POSITION'
  // Shaping (Gobo, Prism, Blades)
  | 'GOBO_WHEEL' | 'GOBO_SPIN' | 'PRISM' | 'PRISM_ROTATION' | 'BLADE'
  // Effects & Control
  | 'EFFECT' | 'EFFECT_SPEED' | 'EFFECT_DURATION' | 'SOUND_SENSITIVITY'
  | 'ROTATION' | 'SPEED' | 'TIME'
  // Other
  | 'FOG' | 'MAINTENANCE' | 'GENERIC' | 'NO_FUNCTION' | 'CUSTOM';

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

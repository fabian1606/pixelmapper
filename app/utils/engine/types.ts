export type ChannelType = 'RED' | 'GREEN' | 'BLUE' | 'WHITE' | 'WARM_WHITE' | 'COOL_WHITE' | 'AMBER' | 'UV' | 'DIMMER' | 'PAN' | 'TILT' | 'STROBE' | 'COLOR_WHEEL' | 'CUSTOM';


export type EffectDirection = 'FORWARD' | 'BACKWARD' | 'CENTER_OUT' | 'OUTSIDE_IN' | 'SPATIAL_X' | 'SPATIAL_Y' | 'SPATIAL_RADIAL';

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
   * The channel type this effect applies to (e.g., 'RED', 'DIMMER').
   */
  targetChannel?: ChannelType;

  /**
   * The direction the effect propagates across the fixtures.
   */
  direction?: EffectDirection;

  /**
   * The strength (amplitude) of the effect to apply around the base value (usually 0 to 255).
   */
  strength: number;

  /**
   * Defines how much the phase is offset per fixture. If 0, all fixtures run in sync.
   */
  fanning: number;

  /**
   * Called once per frame before rendering to accumulate state (e.g., phase based on speed and delta time).
   */
  update?(deltaTime: number): void;

  /**
   * Renders the raw effect wave for a given context.
   * Expected to return a normalized shape value between -1 and 1.
   * @param context The current context the effect is being rendered for.
   */
  render(context: EffectContext): number;
}

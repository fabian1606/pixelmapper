export type ChannelType = 'RED' | 'GREEN' | 'BLUE' | 'DIMMER' | 'PAN' | 'TILT' | 'STROBE' | 'CUSTOM';

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
   * Reserved for future spatial coordinates (X, Y, Z).
   */
  x?: number;
  y?: number;
  z?: number;
}

export interface Effect {
  /**
   * The channel type this effect applies to (e.g., 'RED', 'DIMMER').
   */
  targetChannel?: ChannelType;

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
   * Renders the effect value for a given context.
   * Expected to return a relative value to be added to the base value.
   * @param context The current context the effect is being rendered for.
   */
  render(context: EffectContext): number;
}

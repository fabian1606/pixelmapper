import type { Effect, EffectContext, ChannelType, EffectDirection } from "../types";

export abstract class BaseOscillatorEffect implements Effect {
  public targetChannels: ChannelType[] = [];
  public targetFixtureIds?: (string | number)[];
  public direction: EffectDirection = 'FORWARD';
  public strength: number = 100;

  /**
   * Speed of the oscillator animation.
   */
  public speed: number = 0.002;

  /**
   * Frequency (phase offset scaling) across fixtures.
   */
  public fanning: number = 0.5;

  protected timePhase: number = 0;

  update(deltaTime: number): void {
    this.timePhase += deltaTime * this.speed;
  }

  protected getDirectionalOffset(context: EffectContext): number {
    const { index, fixtureCount, x, y } = context;

    switch (this.direction) {
      case 'FORWARD':
        return index;

      case 'BACKWARD':
        return (fixtureCount - 1) - index;

      case 'CENTER_OUT': {
        const center = (fixtureCount - 1) / 2;
        return Math.abs(index - center);
      }

      case 'OUTSIDE_IN': {
        const center = (fixtureCount - 1) / 2;
        const maxDist = Math.max(center, fixtureCount - 1 - center);
        return maxDist - Math.abs(index - center);
      }

      // Spatial: uses world-space coordinates from the Fixture Editor
      case 'SPATIAL_X':
        // Phase is driven by the X position (0.0 – 1.0 range, scaled for readability)
        return x * fixtureCount;

      case 'SPATIAL_Y':
        return y * fixtureCount;

      case 'SPATIAL_RADIAL': {
        // Distance from center (0.5, 0.5 in normalized space)
        const dx = x - 0.5;
        const dy = y - 0.5;
        const maxRadius = Math.SQRT2 / 2; // max distance from center to corner in normalized space
        return (Math.sqrt(dx * dx + dy * dy) / maxRadius) * fixtureCount;
      }

      default:
        return index;
    }
  }

  render(context: EffectContext): number {
    // Determine mathematical index offset based on direction selection
    const indexOffset = this.getDirectionalOffset(context);

    // Scale offset phase by fanning control
    const phaseOffset = indexOffset * this.fanning;

    // Retrieve generic concrete shape using the accumulated and directional phase
    return this.getShape(this.timePhase + phaseOffset);
  }

  /**
   * Subclasses must implement this to return a value from -1 to 1 based on phase.
   */
  abstract getShape(phase: number): number;
}

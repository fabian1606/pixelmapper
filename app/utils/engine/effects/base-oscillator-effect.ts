import type { Effect, EffectContext, ChannelType, EffectDirection } from "../types";

export abstract class BaseOscillatorEffect implements Effect {
  public targetChannels: ChannelType[] = [];
  public targetFixtureIds?: (string | number)[];
  public direction: EffectDirection = 'LINEAR';
  public originX: number = 0.5;
  public originY: number = 0.5;
  public angle: number = 0;
  public strength: number = 100;
  public reverse: boolean = false;

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
    const { x, y } = context;

    // All coordinates are normalized [0-1] world space
    const dx = x - (this.originX ?? 0.5);
    const dy = y - (this.originY ?? 0.5);
    const angle = this.angle ?? 0;

    switch (this.direction) {
      case 'LINEAR': {
        // Signed projection along the direction vector (origin → endpoint)
        return dx * Math.cos(angle) + dy * Math.sin(angle);
      }
      case 'RADIAL': {
        // Radial distance from origin
        return Math.sqrt(dx * dx + dy * dy);
      }
      case 'SYMMETRICAL': {
        // Mirrored projection
        return Math.abs(dx * Math.cos(angle) + dy * Math.sin(angle));
      }
      default:
        return dx * Math.cos(angle) + dy * Math.sin(angle);
    }
  }

  render(context: EffectContext): number {
    if (this.fanning === 0 || this.direction === 'NONE') {
      return this.getShape(this.timePhase); // All fixtures perfectly synchronized
    }

    // Normalized distance of this fixture along the effect direction
    const dist = this.getDirectionalOffset(context);

    // fanning = one full wavelength in normalized world coords.
    // phase advances by 2π across one wavelength.
    const fanning = Math.max(0.0001, this.fanning);
    let phaseOffset = (dist / fanning) * Math.PI * 2;

    // By default, subtract phaseOffset so waves propagate AWAY from the origin.
    // If reversed, add phaseOffset so waves propagate TOWARDS the origin.
    if (this.reverse) phaseOffset = -phaseOffset;

    return this.getShape(this.timePhase - phaseOffset);
  }

  /**
   * Subclasses must implement this to return a value from -1 to 1 based on phase.
   */
  abstract getShape(phase: number): number;
}

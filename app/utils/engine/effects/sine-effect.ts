import type { Effect, EffectContext, ChannelType } from "../types";

export class SineEffect implements Effect {
  public targetChannel?: ChannelType;
  public strength: number = 100;

  /**
   * Speed of the sine wave animation.
   */
  public speed: number = 0.002;

  /**
   * Frequency of the sine wave across fixtures.
   */
  public fanning: number = 0.5;

  private timePhase: number = 0;

  update(deltaTime: number): void {
    this.timePhase += deltaTime * this.speed;
  }

  render(context: EffectContext): number {
    // Calculate phase based on internal accumulated timePhase and fixture index (offset)
    const offsetPhase = context.index * this.fanning;

    // Calculate sine wave (-1 to 1)
    const sinValue = Math.sin(this.timePhase + offsetPhase);

    // Multiply by strength to get a relative offset from [-strength, +strength]
    return sinValue * this.strength;
  }
}

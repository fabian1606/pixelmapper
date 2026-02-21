import type { Effect, EffectContext } from '~/utils/engine/types';
import type { Fixture } from './core/fixture';
export class EffectEngine {
  private effects: Effect[] = [];

  /**
   * Register a new effect with the engine
   */
  public addEffect(effect: Effect) {
    this.effects.push(effect);
  }

  /**
   * Remove all effects
   */
  public clearEffects() {
    this.effects = [];
  }

  /**
   * Renders a single frame for the given array of fixtures and context time.
   * 
   * @param fixtures The array of fixtures to apply effects to.
   * @param timeMs The current elapsed absolute time in milliseconds.
   * @param deltaTimeMs The time elapsed since the last frame in milliseconds.
   */
  public render(fixtures: Fixture[], timeMs: number, deltaTimeMs: number): void {
    // Update all effects once per frame
    for (const effect of this.effects) {
      if (effect.update) {
        effect.update(deltaTimeMs);
      }
    }

    // Reset all channels for this frame to their base values (additive blending preparation)
    for (const fixture of fixtures) {
      for (const channel of fixture.channels) {
        channel.value = channel.baseValue;
      }
    }

    for (const [i, fixture] of fixtures.entries()) {
      const context: EffectContext = {
        time: timeMs,
        index: i,
      };

      // Evaluate each effect and combine the results via additive blending.
      for (const effect of this.effects) {
        const renderValue = effect.render(context);

        // If the effect specifies a target channel, apply it to those specific channels 
        if (effect.targetChannel) {
          const targetChannels = fixture.getChannelsByType(effect.targetChannel);
          for (const channel of targetChannels) {
            const combined = channel.value + renderValue;
            channel.value = Math.min(Math.max(Math.round(combined), 0), 255);
          }
        }
      }
    }
  }
}

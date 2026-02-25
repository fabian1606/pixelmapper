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
        fixtureCount: fixtures.length,
        x: fixture.fixturePosition.x,
        y: fixture.fixturePosition.y,
      };

      // Evaluate each effect and combine the results via additive blending.
      for (const effect of this.effects) {
        const waveValue = effect.render(context); // Expects -1 to 1

        // If the effect specifies a target channel, apply it to those specific channels 
        if (effect.targetChannel) {
          const targetChannels = fixture.getChannelsByType(effect.targetChannel);
          for (const channel of targetChannels) {
            // Determine maximum and minimum achievable values based on strength
            const targetMax = Math.min(channel.baseValue + effect.strength, 255);
            const targetMin = Math.max(channel.baseValue - effect.strength, 0);

            // Map the expected [-1, 1] wave shape to the [targetMin, targetMax] range
            const mappedValue = targetMin + ((waveValue + 1) / 2) * (targetMax - targetMin);

            // Calculate relative offset it contributes
            const offset = mappedValue - channel.baseValue;

            channel.value += offset;
          }
        }
      }

      // Clamp values strictly to 0-255 after all effects are applied
      for (const channel of fixture.channels) {
        channel.value = Math.min(Math.max(Math.round(channel.value), 0), 255);
      }
    }
  }
}

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
  public render(
    fixtures: Fixture[],
    timeMs: number,
    deltaTimeMs: number
  ): void {
    // Update all effects once per frame
    for (const effect of this.effects) {
      if (effect.update) {
        effect.update(deltaTimeMs);
      }
    }

    // Compute currentBaseValue based on chaser steps
    for (const fixture of fixtures) {
      for (const channel of fixture.channels) {
        const chaserState = channel.chaserConfig;

        if (!chaserState || chaserState.stepsCount <= 1 || !chaserState.isPlaying) {
          // Static / edit mode
          const activeStep = chaserState?.activeEditStep ?? 0;
          channel.currentBaseValue = channel.stepValues[activeStep] ?? 0;
        } else {
          // Chaser playback mode
          const cycleTime = chaserState.stepDurationMs * chaserState.stepsCount;
          const timeInCycle = timeMs % cycleTime;
          const currentIndex = Math.floor(timeInCycle / chaserState.stepDurationMs);
          const nextIndex = (currentIndex + 1) % chaserState.stepsCount;
          const timeInStep = timeInCycle % chaserState.stepDurationMs;

          let factor = 0;
          if (timeInStep < chaserState.fadeDurationMs && chaserState.fadeDurationMs > 0) {
            factor = timeInStep / chaserState.fadeDurationMs;
          } else if (chaserState.fadeDurationMs === 0) {
            factor = 1; // Snaps immediately if fade is 0
          } else {
            factor = 1; // Holding phase
          }

          const v1 = channel.stepValues[currentIndex] ?? 0;
          const v2 = channel.stepValues[nextIndex] ?? 0;
          channel.currentBaseValue = v1 + (v2 - v1) * factor;
        }
        // Initialize channel value via additive blending
        channel.value = channel.currentBaseValue;
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
            const targetMax = Math.min(channel.currentBaseValue + effect.strength, 255);
            const targetMin = Math.max(channel.currentBaseValue - effect.strength, 0);

            // Map the expected [-1, 1] wave shape to the [targetMin, targetMax] range
            const mappedValue = targetMin + ((waveValue + 1) / 2) * (targetMax - targetMin);

            // Calculate relative offset it contributes
            const offset = mappedValue - channel.currentBaseValue;

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

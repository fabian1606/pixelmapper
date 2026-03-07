import type { Effect, EffectContext, SpeedConfig } from '~/utils/engine/types';
import type { Fixture } from './core/fixture';
import type { Channel } from './core/channel';
import { reactive, ref, type Ref } from 'vue';
import { WORLD_WIDTH, WORLD_HEIGHT, FIXTURE_RADIUS } from './constants';

export class EffectEngine {
  public effects = reactive<Effect[]>([]);
  public activeModifier: Ref<Effect | null> = ref(null);

  /**
   * The global DMX buffer containing the final calculated values for up to 512 channels.
   * Format: Uint8Array(512). Access via buffer[startAddress - 1 + addressOffset].
   */
  public dmxBuffer: Uint8Array = new Uint8Array(512);

  /**
   * Global BPM for the engine, used to calculate beat-based speeds.
   */
  public globalBpm = ref<number>(120);

  /**
   * Resolves a SpeedConfig down into exact milliseconds for playback and math.
   */
  public resolveSpeedToMs(speed: SpeedConfig): number {
    if (speed.mode === 'infinite') return Infinity;
    if (speed.mode === 'time') return speed.timeMs;
    // Beat mode: 1 beat = 60000ms / BPM.
    // beatValue of 1 = 1 beat (e.g., 1/4 note in 4/4 time).
    // beatValue of 4 = 4 beats (e.g., 1 full bar).
    return (60000 / this.globalBpm.value) * speed.beatValue;
  }

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
    this.effects.splice(0, this.effects.length);
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
        effect.update(deltaTimeMs, this);
      }
    }

    // Compute currentBaseValue based on chaser steps
    for (const fixture of fixtures) {
      for (const channel of fixture.channels) {
        const chaserState = channel.chaserConfig;

        if (!chaserState || chaserState.stepsCount <= 1 || !chaserState.isPlaying) {
          // Static / edit mode
          const activeStep = chaserState?.activeEditStep ?? 0;
          channel.currentBaseValue = chaserState.stepValues[activeStep] ?? 0;
        } else {
          // Chaser playback mode
          const stepMs = this.resolveSpeedToMs(chaserState.stepDuration);
          const fadeMs = this.resolveSpeedToMs(chaserState.fadeDuration);

          if (stepMs === Infinity) {
            channel.currentBaseValue = chaserState.stepValues[chaserState.activeEditStep] ?? 0;
          } else {
            const beatDurMs = 60000 / this.globalBpm.value;
            const offsetMs = chaserState.stepDuration.mode === 'beat' ? (chaserState.stepDuration.beatOffset || 0) * beatDurMs : 0;
            const cycleTime = stepMs * chaserState.stepsCount;
            const shiftedTime = Math.max(0, timeMs + offsetMs); // apply offset shift to time
            const timeInCycle = shiftedTime % cycleTime;
            const currentIndex = Math.floor(timeInCycle / stepMs);
            const nextIndex = (currentIndex + 1) % chaserState.stepsCount;
            const timeInStep = timeInCycle % stepMs;

            let factor = 0;
            if (timeInStep < fadeMs && fadeMs > 0) {
              factor = timeInStep / fadeMs;
            } else if (fadeMs === 0) {
              factor = 1; // Snaps immediately if fade is 0
            } else {
              factor = 1; // Holding phase
            }

            const v1 = chaserState.stepValues[currentIndex] ?? 0;
            const v2 = chaserState.stepValues[nextIndex] ?? 0;
            channel.currentBaseValue = v1 + (v2 - v1) * factor;
          }
        }
        // Initialize channel value via additive blending
        channel.value = channel.currentBaseValue;
      }
    }

    // Base constants for converting relative fixture dimensions to a normalized world
    // Import them inline or at top of file, assuming they are exported from constants
    // For now we'll import them locally to avoid circulars if not set

    for (const [i, fixture] of fixtures.entries()) {
      // Create a base context focused on the fixture's center
      const fixtureContext: EffectContext = {
        time: timeMs,
        index: i,
        fixtureCount: fixtures.length,
        x: fixture.fixturePosition.x,
        y: fixture.fixturePosition.y,
      };

      // Pre-calculate fixture rotation matrix
      const rotRad = (fixture.rotation ?? 0) * (Math.PI / 180);
      const cosR = Math.cos(rotRad);
      const sinR = Math.sin(rotRad);

      for (const effect of this.effects) {
        if (effect.targetFixtureIds && !effect.targetFixtureIds.includes(fixture.id)) {
          continue;
        }

        if (!effect.targetChannels || effect.targetChannels.length === 0) continue;

        const matchingChannels = fixture.channels.filter((c: Channel) => effect.targetChannels.includes(c.type));

        for (const channel of matchingChannels) {
          let waveValue = 0;

          // If the channel has a specific beam, calculate effect AT that beam's exact physical world position
          if (channel.beamId) {
            const beam = fixture.beams?.find(b => b.id === channel.beamId);
            if (beam) {
              // localX / localY are in [-0.5, 0.5] relative to the fixture's natural footprint
              // we scale this by the configured fixture footprint size physically
              const fWidth = fixture.fixtureSize.x * FIXTURE_RADIUS * 2;
              const fHeight = fixture.fixtureSize.y * FIXTURE_RADIUS * 2;

              const localPx = beam.localX * fWidth;
              const localPy = beam.localY * fHeight;

              // Apply fixture rotation to the beam's local offsets 
              const rotPx = localPx * cosR - localPy * sinR;
              const rotPy = localPx * sinR + localPy * cosR;

              // Convert back to normalized world coordinates [0..1]
              const beamWorldX = fixture.fixturePosition.x + (rotPx / WORLD_WIDTH);
              const beamWorldY = fixture.fixturePosition.y + (rotPy / WORLD_HEIGHT);

              waveValue = effect.render({
                ...fixtureContext,
                x: beamWorldX,
                y: beamWorldY
              });
            } else {
              waveValue = effect.render(fixtureContext);
            }
          } else {
            // Global channel (e.g. Master Dimmer, or a single-pixel fixture)
            waveValue = effect.render(fixtureContext);
          }

          const targetMax = Math.min(channel.currentBaseValue + effect.strength, 255);
          const targetMin = Math.max(channel.currentBaseValue - effect.strength, 0);

          const mappedValue = targetMin + ((waveValue + 1) / 2) * (targetMax - targetMin);
          const offset = mappedValue - channel.currentBaseValue;

          channel.value += offset;
        }
      }

      for (const channel of fixture.channels) {
        channel.value = Math.min(Math.max(Math.round(channel.value), 0), 255);

        // Write final value to global DMX buffer
        this.dmxBuffer[fixture.startAddress - 1 + channel.addressOffset] = channel.value;
      }
    }
  }
}

import type { EffectContext, NoiseParams, SpeedConfig } from "../types";
import type { EffectEngine } from "../engine";
import { BaseEffect } from "./base-effect";
import { perlin2D, seededRandom } from "./noise-math";

export class NoiseEffect extends BaseEffect {
  public override fanning: number = 0;
  public override speed: SpeedConfig = { mode: 'time', timeMs: 500, beatValue: 1, beatOffset: 0 };

  public noiseParams: NoiseParams = {
    noiseType: 'white',
    scale: 1,
    channelMode: 'linked',
    colorVariation: 0,
    fade: 0,
    threshold: 0,
  };

  private time: number = 0;
  private stepValues: Map<number, number> = new Map();
  private lastStepIndex: number = -1;

  override update(deltaTime: number, engine: EffectEngine): void {
    this.time += deltaTime;

    if (this.noiseParams.noiseType === 'step') {
      const durationMs = this.resolveSpeedToMs(this.speed, engine);
      if (durationMs === Infinity || durationMs === 0) return;
      const stepIndex = Math.floor(this.time / durationMs);
      if (stepIndex !== this.lastStepIndex) {
        this.stepValues.clear();
        this.lastStepIndex = stepIndex;
      }
    }
  }

  override render(context: EffectContext): number {
    return this.renderForChannel(context, 0);
  }

  renderForChannel(context: EffectContext, channelSeedOffset: number): number {
    const { noiseType, scale, channelMode, colorVariation } = this.noiseParams;
    const seed = Math.round(context.x * 10000 + context.y * 10000 * 10000);
    const effectiveSeed = channelMode === 'independent'
      ? seed + Math.round(channelSeedOffset * colorVariation * 5000)
      : seed;

    if (noiseType === 'white') {
      const durationMs = this.speed.mode === 'infinite' ? Infinity : this.speed.mode === 'beat' ? Infinity : this.speed.timeMs;
      if (durationMs === Infinity) return seededRandom(effectiveSeed) * 2 - 1;
      const tick = Math.floor(this.time / durationMs);
      return seededRandom(effectiveSeed + tick * 997) * 2 - 1;

    } else if (noiseType === 'perlin') {
      const timeSec = this.time / 1000;
      const speedFactor = this.speed.timeMs > 0 ? 1000 / this.speed.timeMs : 1;
      const ox = channelMode === 'independent' ? channelSeedOffset * colorVariation * 17.3 : 0;
      const oy = channelMode === 'independent' ? channelSeedOffset * colorVariation * 31.7 : 0;
      return perlin2D(context.x * scale * 4 + timeSec * speedFactor + ox, context.y * scale * 4 + oy);

    } else {
      // step
      const key = effectiveSeed;
      if (!this.stepValues.has(key)) {
        this.stepValues.set(key, seededRandom(effectiveSeed + this.lastStepIndex * 1013) * 2 - 1);
      }
      return this.stepValues.get(key)!;
    }
  }

  private resolveSpeedToMs(speed: SpeedConfig, engine: EffectEngine): number {
    if (speed.mode === 'infinite') return Infinity;
    if (speed.mode === 'beat') return (60000 / engine.globalBpm.value) * speed.beatValue;
    return speed.timeMs;
  }

  override getPreviewCSS(): Record<string, string> {
    return {};
  }
}

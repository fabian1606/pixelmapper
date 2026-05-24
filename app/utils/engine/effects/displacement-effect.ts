import type { DisplacementParams, EffectContext, SpeedConfig } from "../types";
import type { EffectEngine } from "../engine";
import { BaseEffect } from "./base-effect";
import { perlin2D, seededRandom } from "./noise-math";

export class DisplacementEffect extends BaseEffect {
  public override fanning: number = 0;
  public override speed: SpeedConfig = { mode: 'beat', timeMs: 2000, beatValue: 1, beatOffset: 0 };

  public displacementParams: DisplacementParams = {
    patternType: 'perlin',
    amountX: 0.1,
    amountY: 0.1,
    scale: 2,
    seed: 0,
  };

  private time: number = 0;

  override update(deltaTime: number, _engine: EffectEngine): void {
    this.time += deltaTime;
  }

  /** Returns [dx, dy] displacement in normalized world space for a given (x, y). */
  sampleDisplacement(x: number, y: number): [number, number] {
    const { patternType, amountX, amountY, scale, seed } = this.displacementParams;
    const s = (this.strength / 100);
    const t = this.time / 1000;

    if (patternType === 'perlin') {
      const dx = perlin2D(x * scale + t + seed, y * scale + seed * 0.31) * amountX * s;
      const dy = perlin2D(x * scale + seed * 0.53, y * scale + t + seed) * amountY * s;
      return [dx, dy];
    } else {
      // white — deterministic per pixel, static (not animated)
      const seedX = Math.round(x * 10000) + Math.round(y * 10000) * 100003 + seed * 7;
      const seedY = seedX ^ 0xdeadbeef;
      const dx = (seededRandom(seedX) * 2 - 1) * amountX * s;
      const dy = (seededRandom(seedY) * 2 - 1) * amountY * s;
      return [dx, dy];
    }
  }

  // DisplacementEffect does not produce a DMX value itself; render() returns 0.
  override render(_context: EffectContext): number {
    return 0;
  }

  override getPreviewCSS(): Record<string, string> {
    return {};
  }
}

import type { ColorParams, EffectContext, SpeedConfig } from '../types';
import { BaseEffect } from './base-effect';

export class ColorEffect extends BaseEffect {
  public override fanning: number = 0;
  public override speed: SpeedConfig = { mode: 'time', timeMs: 1000, beatValue: 1, beatOffset: 0 };

  public colorParams: ColorParams = { hueShift: 0, saturation: 1 };

  override update(_deltaTime: number, _engine: any): void {}

  override render(_context: EffectContext): number {
    // Color modifiers are applied as a post-process RGB pass in the engine.
    // Individual channel render returns 0 (no additive offset).
    return 0;
  }

  override getPreviewCSS(): Record<string, string> {
    return {};
  }
}

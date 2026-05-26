import type { SpeedCurveParams, EffectContext, SpeedConfig } from '../types';
import type { EffectEngine } from '../engine';
import { BaseEffect } from './base-effect';

export class SpeedCurveEffect extends BaseEffect {
  public override fanning: number = 0;
  public override speed: SpeedConfig = { mode: 'beat', timeMs: 2000, beatValue: 1, beatOffset: 0 };

  public speedCurveParams: SpeedCurveParams = {
    points: [{ x: 0, y: 1 }, { x: 1, y: 1 }],
    maxMultiplier: 4,
    cycleBeats: 1,
  };

  override update(_deltaTime: number, _engine: EffectEngine): void {}

  // SpeedCurveEffect is a pre-pass modifier — it does not produce DMX values directly.
  override render(_context: EffectContext): number {
    return 0;
  }

  override getPreviewCSS(): Record<string, string> {
    return {};
  }
}

/**
 * Color Adjust 1.x → Color Shift 2 (plan M7.7): hue shift/cycle become mode
 * *Shift* with a free profile sampled from the old cycle shape
 * (`p(x) = (shape(fract(−x)) + 1) / 2`, motion *Run*), so
 * `hue = hueShift + hueRange·(2p − 1)` matches the former
 * `hueShift + shape·hueRange`. Residual differences: the saturation cycle
 * (`satRange`) has no equivalent and is dropped (saturation stays constant);
 * hard edges blur by one LUT step.
 */
import type { CurvePointV2, ParamValue } from '@pixelmapper/extension-api';
import { evaluateShapeV1 } from './waveform-v1';

/** Old color-adjust params (manifest 1.0.0). */
export interface ColorAdjustV1Params {
  hueShift?: number;
  saturation?: number;
  hueRange?: number;
  satRange?: number;
  shape?: string;
  shapeParam?: number;
}

/** Color Shift 2 params for old color-adjust params. */
export function migrateColorAdjustV1(p: ColorAdjustV1Params): Record<string, ParamValue> {
  const points: CurvePointV2[] = [];
  for (let i = 0; i < 128; i++) {
    const t = i / 127;
    const phase = 1 - t * 2;
    const out = evaluateShapeV1(String(p.shape ?? 'sine'), phase - Math.floor(phase), Number(p.shapeParam ?? 0.5));
    points.push({ x: t, y: Math.round(Math.max(0, Math.min(1, (out + 1) / 2)) * 10000) / 10000, kind: 'linear' });
  }
  return {
    mode: 'shift',
    hueShift: Number(p.hueShift ?? 0),
    hueRange: Number(p.hueRange ?? 0),
    saturation: Number(p.saturation ?? 1),
    satDip: 0,
    profile: { points },
    motion: { shape: 'run', args: {} },
  };
}

/**
 * Waveform 1.x → Wave 2 (plan M6.4). The old plugin evaluated
 * `shape(phase)` (+ window, offset, floor) in bipolar output; Wave evaluates
 * `profile(spatial − motion)` in scale output. With motion *Run* and the
 * migrated distribution, `x = −phase`, so the old cycle becomes a free
 * profile sampled at 128 points: `v(x) = (out(fract(−x)) + 1) / 2`.
 *
 * Exact at base 100 % (scale equals bipolar there). Residual differences:
 * below base 100 % dips are relative instead of absolute (A20); the floor
 * with strength < 1 − floor clamps at 0; Catmull/LUT interpolation ≤ 1/64.
 */
import type { CurvePointV2, ParamValue } from '@pixelmapper/extension-api';

const SHAPES = ['sine', 'square', 'triangle', 'sawtooth', 'bounce', 'ramp', 'smooth'];

/** Round half away from zero (AssemblyScript `roundAway`). */
const roundAway = (v: number) => Math.sign(v) * Math.round(Math.abs(v));

/** Port of the SDK `evaluateShape` (t ∈ [0, 1), output ≈ [−1, 1]). */
export function evaluateShapeV1(shape: string, t: number, param: number): number {
  switch (shape) {
    case 'square': return t < 0.05 + param * 0.9 ? 1 : -1;
    case 'triangle': {
      const peak = 0.05 + param * 0.9;
      return t < peak ? (2 * t) / peak - 1 : 1 - (2 * (t - peak)) / (1 - peak);
    }
    case 'sawtooth': return param < 0.5 ? 1 - 2 * t : 2 * t - 1;
    case 'bounce': return Math.abs(Math.sin(roundAway(1 + param * 4) * Math.PI * t));
    case 'ramp': {
      const soft = 0.1 + param * 9.9;
      const denom = Math.tanh(soft * 3);
      return Math.abs(denom) < 1e-6 ? (t < 0.5 ? -1 : 1) : Math.tanh(soft * (t - 0.5) * 6) / denom;
    }
    case 'smooth': {
      const peak = 0.05 + param * 0.9;
      return t <= peak ? -Math.cos((Math.PI * t) / peak) : Math.cos((Math.PI * (t - peak)) / (1 - peak));
    }
    default: return Math.sin(t * 2 * Math.PI);
  }
}

/** Old waveform params (manifest 1.0.0). */
export interface WaveformV1Params {
  shape?: string;
  param?: number;
  start?: number;
  end?: number;
  offset?: number;
  useFloor?: boolean;
  floor?: number;
}

/** Raw bipolar output of the old plugin at phase `t` (base 100 %). */
export function waveformV1Output(p: WaveformV1Params, phase: number, strength: number): number {
  const shape = SHAPES.includes(String(p.shape)) ? String(p.shape) : 'sine';
  const param = Number(p.param ?? 0.5);
  const start = Number(p.start ?? 0);
  const end = Number(p.end ?? 1);
  const offset = Number(p.offset ?? 0);
  const t = phase - Math.floor(phase);
  if (start >= end) return evaluateShapeV1(shape, t, param) + offset;
  if (t < start || t > end) {
    if (!p.useFloor) return offset;
    const st = Math.max(strength, 1e-6);
    return Math.max(-2, Math.min(2, 1 - (2 * (1 - Number(p.floor ?? 0))) / st));
  }
  return evaluateShapeV1(shape, (t - start) / (end - start), param) + offset;
}

/** Wave 2 params for old waveform params. */
export function migrateWaveformV1(p: WaveformV1Params, strength: number): Record<string, ParamValue> {
  const points: CurvePointV2[] = [];
  for (let i = 0; i < 128; i++) {
    const t = i / 127;
    const x = -1 + 2 * t;
    const out = waveformV1Output(p, -x, strength);
    points.push({ x: t, y: Math.round(Math.max(0, Math.min(1, (out + 1) / 2)) * 10000) / 10000, kind: 'linear' });
  }
  return { profile: { points }, motion: { shape: 'run', args: {} }, invert: false };
}

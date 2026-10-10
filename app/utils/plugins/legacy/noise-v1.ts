/**
 * Noise 1.x → Noise 2 (plan M9.6). The algorithm choice becomes positions on
 * the continuous axes: white → coherence 0, sync 0, hardness 1; step →
 * sync 1, hardness 1; perlin → coherence 1, hardness 0. Fade → 1 − hardness.
 * Residual differences: the old Perlin `scale` has no equivalent (Coherence
 * sets the patch size); the threshold gate becomes a lower maximum
 * (rangeMax = 1 − threshold); random sequences differ.
 */
import type { ParamValue } from '@pixelmapper/extension-api';

/** Old noise params (manifest 1.0.0). */
export interface NoiseV1Params {
  noiseType?: string;
  scale?: number;
  colorVariation?: number;
  fade?: number;
  threshold?: number;
}

/** Noise 2 params for old noise params. */
export function migrateNoiseV1(p: NoiseV1Params): Record<string, ParamValue> {
  const type = String(p.noiseType ?? 'white');
  const fadeHardness = 1 - Math.max(0, Math.min(1, Number(p.fade ?? 0)));
  const axes = type === 'perlin'
    ? { coherence: 1, sync: 0, hardness: 0 }
    : type === 'step'
      ? { coherence: 0, sync: 1, hardness: fadeHardness }
      : { coherence: 0, sync: 0, hardness: fadeHardness };
  return {
    mode: 'level',
    rangeMin: 0,
    rangeMax: Math.round((1 - Math.max(0, Math.min(1, Number(p.threshold ?? 0)))) * 1000) / 1000,
    eventRate: 0,
    eventLength: 0.1,
    eventDir: 'up',
    ...axes,
    count: 0,
    colorVariation: Math.max(0, Math.min(1, Number(p.colorVariation ?? 0))),
  };
}

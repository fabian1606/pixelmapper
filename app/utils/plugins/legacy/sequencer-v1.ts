/**
 * Sequencer 1.x → Pattern 2 / Noise 2 (plan M8.5). Patterns become groups of
 * the shared distribution:
 * - split: Pattern, 2 bands over a linear distribution across the split
 *   line (spatial 0.5 = the line), swapping every half of the former cycle
 *   (the speed halves);
 * - sections: Pattern, 8 alternating bands over a linear distribution along
 *   the bands (8 cells of the old width);
 * - checkerboard: Pattern alternating over the order (approximation: a 2D
 *   checkerboard has no order equivalent);
 * - scatter: Noise *Random Pick* (peaks on the beat; the density is the share on);
 * - flow: Noise with coherence 1, hard (moving coherent boundary).
 * Residual differences are documented in the plan (M8.5).
 */
import type { Distribution, ParamValue, StepsValue } from '@pixelmapper/extension-api';
import { createDistribution } from '~/utils/engine/distribution/create';
import type { SpeedConfig } from '~/utils/engine/types';
import type { LegacyPatch } from '../builtin-legacy';

/** Old sequencer params (manifest 1.0.0). */
export interface SequencerV1Params {
  patternType?: string;
  origin?: { x: number; y: number };
  angle?: number;
  scale?: number;
  density?: number;
  densityVariation?: number;
  invert?: boolean;
}

const SWAP: StepsValue = { groups: 2, steps: 2, cells: [[false, true], [true, false]] };
/** Eight bands, odd ones on in the first step, even ones in the second. */
const STRIPES: StepsValue = { groups: 8, steps: 2, cells: [0, 1].map(s => Array.from({ length: 8 }, (_, g) => g % 2 !== s)) };

/** Halves a speed (two Pattern steps per former cycle). */
function halfSpeed(s: SpeedConfig): SpeedConfig {
  return { ...s, timeMs: s.timeMs / 2, beatValue: s.beatValue / 2 };
}

/** The replacement for an old sequencer instance. */
export function migrateSequencerV1(p: SequencerV1Params, m: { speed?: SpeedConfig; targetFixtureIds?: unknown[]; distribution?: Distribution }): LegacyPatch {
  const type = String(p.patternType ?? 'split');
  const origin = p.origin ?? { x: 0.5, y: 0.5 };
  const angle = Number(p.angle ?? 0);
  const invert = !!p.invert;
  const speed = m.speed ? halfSpeed(m.speed) : undefined;
  if (type === 'scatter') {
    const share = Math.max(0.01, Math.min(1, Number(p.density ?? 0.5)));
    return {
      alias: '@pixelmapper/noise',
      params: { hardness: 1, rangeMin: 0, rangeMax: 0, eventRate: share, eventLength: 1, eventDir: 'up', coherence: 0, sync: 1, colorVariation: 0 },
      distribution: createDistribution({ mode: 'order' }),
    };
  }
  if (type === 'flow') {
    return {
      alias: '@pixelmapper/noise',
      params: { coherence: 1, hardness: 1, sync: 0, rangeMin: 0, rangeMax: 1, eventRate: 0, eventLength: 0.1, eventDir: 'up', colorVariation: 0 },
      distribution: createDistribution({ mode: 'linear' }),
    };
  }
  if (type === 'checkerboard') {
    return { params: { steps: SWAP, transition: 0, invert }, distribution: createDistribution({ mode: 'order' }), speed };
  }
  // Split: normal of the split line; sections: bands along the angle.
  const dir = type === 'split' ? { x: -Math.sin(angle), y: Math.cos(angle) } : { x: Math.cos(angle), y: Math.sin(angle) };
  const len = type === 'split' ? 4 : Math.max(0.01, Number(p.scale ?? 0.1)) * 8;
  const start = type === 'split' ? { x: origin.x - dir.x * len / 2, y: origin.y - dir.y * len / 2 } : origin;
  return {
    params: { steps: type === 'split' ? SWAP : STRIPES, transition: 0, invert },
    distribution: createDistribution({ mode: 'linear', origin: start, end: { x: start.x + dir.x * len, y: start.y + dir.y * len } }),
    speed,
  };
}

/**
 * Noise 2.x → 3 (modifier review). Mode and count are gone:
 * - Pick (N fixtures on per step) becomes peaks on the beat — range 0–0,
 *   peaks up, one step long, frequency = the share of fixtures on (count 0
 *   = a third), sync 1; the order spread stays.
 * - "All the same" now means one value for the whole rig; a Level instance
 *   that used it (each fixture on its own before) moves to Fixture by
 *   fixture so it keeps its look.
 * Peaks now rise to full / dip to dark after the range (before: inside it).
 */
import type { Distribution, ParamValue } from '@pixelmapper/extension-api';
import type { LegacyPatch } from '../builtin-legacy';

/** The Noise 3 params (and distribution) of a Noise 2 instance. */
export function migrateNoiseV2(p: Record<string, ParamValue>, d?: Distribution, fixtures = 0): LegacyPatch {
  const { mode, count, ...params } = p;
  if (mode === 'pick') {
    const n = Number(count ?? 0);
    const share = n > 0 && fixtures > 0 ? Math.min(1, n / fixtures) : 1 / 3;
    return {
      params: { ...params, rangeMin: 0, rangeMax: 0, eventRate: Math.round(share * 1000) / 1000, eventLength: 1, eventDir: 'up', sync: 1 },
    };
  }
  if (d && d.scope !== 'within' && d.mode === 'none') return { params, distribution: { ...d, mode: 'order' } };
  return { params };
}

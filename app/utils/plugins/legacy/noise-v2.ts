/**
 * Noise 2.x → 3 (modifier review). Mode, count and the events are gone:
 * - Pick (N fixtures on per step) becomes hard random levels on the beat
 *   that are bright for the share of fixtures that were on (Frequency =
 *   count / fixtures, count 0 = a third); the order spread stays.
 * - Events (occasional peaks) have no equivalent and are dropped.
 * - "All the same" now means one value for the whole rig; a Level instance
 *   that used it (each fixture on its own before) moves to Fixture by
 *   fixture so it keeps its look.
 */
import type { Distribution, ParamValue } from '@pixelmapper/extension-api';
import type { LegacyPatch } from '../builtin-legacy';

/** The Noise 3 params (and distribution) of a Noise 2 instance. */
export function migrateNoiseV2(p: Record<string, ParamValue>, d?: Distribution, fixtures = 0): LegacyPatch {
  const { mode, count, eventRate: _rate, eventLength: _length, eventDir: _dir, ...params } = p;
  if (mode === 'pick') {
    const n = Number(count ?? 0);
    const share = n > 0 && fixtures > 0 ? Math.min(1, n / fixtures) : 1 / 3;
    return {
      params: { ...params, rangeMin: 0, rangeMax: 1, frequency: Math.round(share * 1000) / 1000, hardness: 1, sync: 1 },
    };
  }
  if (d && d.scope !== 'within' && d.mode === 'none') return { params, distribution: { ...d, mode: 'order' } };
  return { params };
}

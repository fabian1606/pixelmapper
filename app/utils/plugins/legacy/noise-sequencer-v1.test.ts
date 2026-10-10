// @vitest-environment node
/**
 * Noise 1.x and Sequencer 1.x legacy mappings (plan M8.5, M9.6).
 */
import { describe, expect, it } from 'vitest';
import { migrateModifiersDeep } from '~/utils/persistence/migrations/v3-distribution';
import { sampleDistribution } from '~/utils/engine/distribution/sample';
import { BUILTIN_BY_ALIAS } from '../builtin-index';
import { migrateNoiseV1 } from './noise-v1';
import legacy from '../builtin-legacy.json';

const hashOf = (alias: string) => (legacy as { alias: string; version: string; hash: string }[]).find(e => e.alias === alias && e.version === '1.0.0')!.hash;
const speed = { mode: 'beat', timeMs: 2000, beatValue: 2, beatOffset: 0 };

/** Migrates one old instance. */
function migrate(alias: string, params: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const [m] = migrateModifiersDeep([{ id: 'x', plugin: hashOf(alias), signature: 'scalar', speed, params, distribution: { mode: 'none' }, ...extra }]);
  return m as unknown as { plugin: string; params: Record<string, unknown>; distribution: Parameters<typeof sampleDistribution>[0]; speed: typeof speed };
}

describe('noise 1.x', () => {
  it('maps the algorithm onto the axes', () => {
    expect(migrateNoiseV1({ noiseType: 'white', fade: 0 })).toMatchObject({ coherence: 0, sync: 0, hardness: 1 });
    expect(migrateNoiseV1({ noiseType: 'step', fade: 0.4 })).toMatchObject({ coherence: 0, sync: 1, hardness: 0.6 });
    expect(migrateNoiseV1({ noiseType: 'perlin' })).toMatchObject({ coherence: 1, hardness: 0 });
    expect(migrateNoiseV1({ threshold: 0.3 })).toMatchObject({ rangeMin: 0, rangeMax: 0.7 });
    expect(migrate('@pixelmapper/noise', { noiseType: 'white' }).plugin).toBe(BUILTIN_BY_ALIAS['@pixelmapper/noise']);
  });
});

describe('sequencer 1.x', () => {
  it('split: blocks over a linear distribution whose middle is the split line; speed halves', () => {
    const m = migrate('@pixelmapper/sequencer', { patternType: 'split', origin: { x: 0.5, y: 0.5 }, angle: 0 });
    expect(m.plugin).toBe(BUILTIN_BY_ALIAS['@pixelmapper/sequencer']);
    expect(m.params.arrange).toBe('blocks');
    expect(m.speed.beatValue).toBe(1);
    // angle 0 → old "on" side is y > origin.y: spatial ≥ 0.5 there.
    const s = (y: number) => sampleDistribution(m.distribution, 0, { x: 0.3, y, fixtureRank: -1, head: 0, headCount: 1 }).spatial;
    expect(s(0.6)).toBeGreaterThan(0.5);
    expect(s(0.4)).toBeLessThan(0.5);
  });

  it('scatter becomes Noise Random Pick with density × targets on', () => {
    const m = migrate('@pixelmapper/sequencer', { patternType: 'scatter', density: 0.5 }, { targetFixtureIds: ['a', 'b', 'c', 'd', 'e', 'f'] });
    expect(m.plugin).toBe(BUILTIN_BY_ALIAS['@pixelmapper/noise']);
    expect(m.params).toMatchObject({ mode: 'pick', count: 3 });
    expect(m.distribution.mode).toBe('order');
  });

  it('flow becomes coherent Noise; checkerboard alternates over the order', () => {
    expect(migrate('@pixelmapper/sequencer', { patternType: 'flow' }).params).toMatchObject({ mode: 'level', coherence: 1 });
    const c = migrate('@pixelmapper/sequencer', { patternType: 'checkerboard' });
    expect(c.params.arrange).toBe('alternate');
    expect(c.distribution.mode).toBe('order');
  });
});

// @vitest-environment node
/**
 * Noise 1.x/2.x and Sequencer 1.x/2.x legacy mappings (plan M8.5, M9.6, modifier review).
 */
import { describe, expect, it } from 'vitest';
import { migrateModifiersDeep } from '~/utils/persistence/migrations/v3-distribution';
import { sampleDistribution } from '~/utils/engine/distribution/sample';
import { BUILTIN_BY_ALIAS } from '../builtin-index';
import { migrateNoiseV1 } from './noise-v1';
import { migrateNoiseV2 } from './noise-v2';
import { migrateSequencerV2 } from './sequencer-v2';
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
    const m = migrate('@pixelmapper/noise', { noiseType: 'white' });
    expect(m.plugin).toBe(BUILTIN_BY_ALIAS['@pixelmapper/noise']);
    expect(m.params).not.toHaveProperty('mode');
    // "All the same" is one value for the whole rig now: old per-fixture noise moves to Fixture by fixture.
    expect(m.distribution.mode).toBe('order');
  });
});

describe('sequencer 1.x', () => {
  it('split: two bands over a linear distribution whose middle is the split line; speed halves', () => {
    const m = migrate('@pixelmapper/sequencer', { patternType: 'split', origin: { x: 0.5, y: 0.5 }, angle: 0 });
    expect(m.plugin).toBe(BUILTIN_BY_ALIAS['@pixelmapper/sequencer']);
    expect(m.params).not.toHaveProperty('arrange');
    expect((m.params.steps as { groups: number }).groups).toBe(2);
    expect(m.speed.beatValue).toBe(1);
    // angle 0 → old "on" side is y > origin.y: spatial ≥ 0.5 there.
    const s = (y: number) => sampleDistribution(m.distribution, 0, { x: 0.3, y, fixtureRank: -1, head: 0, headCount: 1 }).spatial;
    expect(s(0.6)).toBeGreaterThan(0.5);
    expect(s(0.4)).toBeLessThan(0.5);
  });

  it('scatter becomes Noise peaks on the beat with the density as the share on', () => {
    const m = migrate('@pixelmapper/sequencer', { patternType: 'scatter', density: 0.5 }, { targetFixtureIds: ['a', 'b', 'c', 'd', 'e', 'f'] });
    expect(m.plugin).toBe(BUILTIN_BY_ALIAS['@pixelmapper/noise']);
    expect(m.params).toMatchObject({ rangeMax: 0, eventRate: 0.5, eventLength: 1, sync: 1 });
    expect(m.distribution.mode).toBe('order');
  });

  it('flow becomes coherent Noise; checkerboard alternates over the order', () => {
    expect(migrate('@pixelmapper/sequencer', { patternType: 'flow' }).params).toMatchObject({ coherence: 1 });
    const c = migrate('@pixelmapper/sequencer', { patternType: 'checkerboard' });
    expect(c.params).not.toHaveProperty('arrange');
    expect(c.distribution.mode).toBe('order');
  });
});

describe('2.x → 3 (modifier review)', () => {
  const d = (mode: string, extra: Record<string, unknown> = {}) => ({ scope: 'across', mode, origin: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 }, reverse: false, order: { ranks: {}, mirror: false, snap: 0 }, grouping: {}, withinOffset: 'none', ...extra }) as never;

  it('Noise Pick becomes peaks on the beat; Level with All the same moves to Fixture by fixture', () => {
    const pick = migrateNoiseV2({ mode: 'pick', count: 2, hardness: 1 }, d('order'), 8);
    expect(pick.params).toMatchObject({ rangeMin: 0, rangeMax: 0, eventRate: 0.25, eventLength: 1, sync: 1, hardness: 1 });
    expect(pick.params).not.toHaveProperty('count');
    expect(migrateNoiseV2({ mode: 'pick', count: 0 }, d('order')).params.eventRate).toBe(0.333);
    expect(migrateNoiseV2({ mode: 'level' }, d('none')).distribution?.mode).toBe('order');
    expect(migrateNoiseV2({ mode: 'level' }, d('linear')).distribution).toBeUndefined();
  });

  it('Pattern Blocks over the order become bands along the line; Alternate keeps the order', () => {
    const line = { a: { x: 0.1, y: 0.2 }, b: { x: 0.9, y: 0.2 } };
    const b = migrateSequencerV2({ arrange: 'blocks', transition: 0 }, d('order', { order: { ranks: {}, mirror: false, snap: 0, line } }));
    expect(b.params).toEqual({ transition: 0 });
    expect(b.distribution).toMatchObject({ mode: 'linear', origin: line.a, end: line.b });
    expect(migrateSequencerV2({ arrange: 'blocks' }, d('order', { order: { ranks: {}, mirror: true, snap: 0, line } })).distribution?.mode).toBe('radial');
    const a = migrateSequencerV2({ arrange: 'alternate' }, d('order'));
    expect(a).toEqual({ params: {} });
  });
});

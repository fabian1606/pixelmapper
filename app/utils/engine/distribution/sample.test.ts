// @vitest-environment node
/**
 * Parity of the TS distribution port with rs-engine (plan M3.6): both run the
 * shared table `rs-engine/core/src/distribution_table.json`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DistributionPatch } from '@pixelmapper/extension-api';
import { createDistribution } from './create';
import { frameCounts, permutation, sampleDistribution } from './sample';

interface TableSample { x: number; y: number; fixtureRank: number; head: number; headCount: number; expect: [number, number, number] }
interface TableCase {
  name: string;
  dist: Omit<DistributionPatch, 'origin' | 'end'> & { origin?: [number, number]; end?: [number, number] };
  rankCount: number;
  samples: TableSample[];
}

const table = JSON.parse(readFileSync(new URL('../../../../rs-engine/core/src/distribution_table.json', import.meta.url), 'utf8')) as {
  permutations: { count: number; seed: number; perm: number[] }[];
  cases: TableCase[];
};

describe('distribution parity with rs-engine', () => {
  it('permutations', () => {
    for (const p of table.permutations) expect([...permutation(p.count, p.seed)]).toEqual(p.perm);
  });

  it.each(table.cases.map(c => [c.name, c] as const))('%s', (_, c) => {
    const { origin, end, ...rest } = c.dist;
    const d = createDistribution({
      ...rest,
      ...(origin ? { origin: { x: origin[0], y: origin[1] } } : {}),
      ...(end ? { end: { x: end[0], y: end[1] } } : {}),
    });
    for (const s of c.samples) {
      const out = sampleDistribution(d, c.rankCount, s);
      expect(out.spatial).toBeCloseTo(s.expect[0], 5);
      expect(out.rank).toBe(s.expect[1]);
      expect(out.group).toBe(s.expect[2]);
    }
  });

  it('frame counts', () => {
    expect(frameCounts(createDistribution({ mode: 'order' }), 5, 1)).toEqual({ rankCount: 5, distGroupCount: 0 });
    expect(frameCounts(createDistribution({ mode: 'linear', grouping: { kind: 'everyN', n: 2 } }), 0, 1)).toEqual({ rankCount: 16, distGroupCount: 2 });
    expect(frameCounts(createDistribution({ scope: 'within', grouping: { kind: 'everyN', n: 2 } }), 0, 8)).toEqual({ rankCount: 8, distGroupCount: 2 });
  });
});

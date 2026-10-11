// @vitest-environment node
/**
 * Noise goldens properties (plan M9.6, review): levels without peaks stay
 * inside their range and vary across fixtures; Random Pick lights a third of
 * the rig; All the same (Lightning) gives the whole rig one value.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const goldens = JSON.parse(readFileSync(join(import.meta.dirname, 'goldens.json'), 'utf8')) as {
  cases: { name: string; params: Record<string, number | string>; ctx: { spread?: number }; expected: number[][] }[];
};

describe('noise golden properties', () => {
  it('levels stay in [rangeMin, rangeMax] and differ between fixtures (no peaks)', () => {
    for (const c of goldens.cases.filter(c => Number(c.params.eventRate) === 0)) {
      const vals = c.expected.map(e => e[0]!);
      for (const v of vals) {
        expect(v).toBeGreaterThanOrEqual(Number(c.params.rangeMin) - 1e-4);
        expect(v).toBeLessThanOrEqual(Number(c.params.rangeMax) + 1e-4);
      }
      if (Number(c.params.rangeMax) - Number(c.params.rangeMin) > 0.2 && c.ctx.spread !== 0) expect(Math.max(...vals) - Math.min(...vals), c.name).toBeGreaterThan(0.02);
    }
  });

  it('Random Pick lights a third of the fixtures', () => {
    for (const c of goldens.cases.filter(c => c.name.startsWith('random-pick'))) {
      expect(c.expected.filter(e => e[0]! > 0.5)).toHaveLength(3);
    }
  });

  it('All the same: the whole rig shares one value', () => {
    const cases = goldens.cases.filter(c => c.ctx.spread === 0);
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      const vals = c.expected.map(e => e[0]!);
      expect(Math.max(...vals) - Math.min(...vals), c.name).toBeLessThan(1e-6);
    }
  });
});

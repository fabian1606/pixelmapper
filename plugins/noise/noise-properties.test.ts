// @vitest-environment node
/**
 * Noise goldens properties (plan M9.6, review): levels stay inside their
 * range and vary across fixtures; Frequency sets how much of the time it is
 * bright (Lightning mostly dark, Faulty mostly bright); All the same gives
 * the whole rig one value.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const goldens = JSON.parse(readFileSync(join(import.meta.dirname, 'goldens.json'), 'utf8')) as {
  cases: { name: string; params: Record<string, number | string>; ctx: { spread?: number }; expected: number[][] }[];
};

describe('noise golden properties', () => {
  it('levels stay in [rangeMin, rangeMax] and differ between fixtures', () => {
    for (const c of goldens.cases) {
      const vals = c.expected.map(e => e[0]!);
      for (const v of vals) {
        expect(v).toBeGreaterThanOrEqual(Number(c.params.rangeMin) - 1e-4);
        expect(v).toBeLessThanOrEqual(Number(c.params.rangeMax) + 1e-4);
      }
      if (Number(c.params.rangeMax) - Number(c.params.rangeMin) > 0.2 && c.ctx.spread !== 0 && Math.abs(Number(c.params.frequency) - 0.5) < 0.2) expect(Math.max(...vals) - Math.min(...vals), c.name).toBeGreaterThan(0.02);
    }
  });

  it('Frequency: the mean level follows it (low = mostly dark, high = mostly bright)', () => {
    const mean = (id: string) => {
      const vals = goldens.cases.filter(c => c.name.startsWith(`${id} `)).flatMap(c => c.expected.map(e => e[0]!));
      return vals.reduce((s, v) => s + v, 0) / vals.length;
    };
    expect(mean('random-pick')).toBeLessThan(0.35);
    expect(mean('faulty')).toBeGreaterThan(0.8);
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

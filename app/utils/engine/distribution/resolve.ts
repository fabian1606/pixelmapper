/**
 * Resolves an instance's distribution against the current fixtures (plan
 * M3.4): rank table of the targeted fixtures, rank count and the `ticks`
 * used by curve shapes and editors. Used by the modifiers packet, the card
 * (curve ticks) and the canvas overlays (rank badges).
 */
import type { Distribution } from '@pixelmapper/extension-api';
import { resolveRanks } from './order';

/** A fixture as seen by distribution resolution. */
export interface DistributionFixture {
  id: string | number;
  /** Normalized world position. */
  fixturePosition: { x: number; y: number };
  /** Heads/pixels (beams); at least one. */
  beams: readonly unknown[];
}

/** Result of `resolveDistribution`. */
export interface ResolvedDistribution {
  /** Order rank by fixture id (only when the distribution uses ranks). */
  ranks: Record<string, number>;
  rankCount: number;
  /** Largest head count among the targeted fixtures. */
  maxHeads: number;
  /** Ticks for curve shapes/editors: ranks, heads (within) or targeted fixtures. */
  ticks: number;
  /** Targeted fixtures in layout order. */
  targeted: DistributionFixture[];
}

/** True when the distribution needs an order rank table. */
export function usesRanks(d: Distribution): boolean {
  return (d.scope === 'across' && d.mode === 'order') || (d.scope === 'within' && d.withinOffset === 'order');
}

/** Resolves ranks and counts of an instance over `fixtures`. */
export function resolveDistribution(
  m: { distribution: Distribution; targetFixtureIds?: (string | number)[] },
  fixtures: readonly DistributionFixture[],
): ResolvedDistribution {
  const ids = m.targetFixtureIds ? new Set(m.targetFixtureIds.map(String)) : null;
  const targeted = ids ? fixtures.filter(f => ids.has(String(f.id))) : [...fixtures];
  const maxHeads = targeted.reduce((n, f) => Math.max(n, f.beams.length), 1);
  const d = m.distribution;
  const { ranks, rankCount } = usesRanks(d)
    ? resolveRanks(d, targeted.map(f => ({ id: f.id, x: f.fixturePosition.x, y: f.fixturePosition.y })))
    : { ranks: {}, rankCount: 0 };
  const ticks = d.scope === 'within' ? maxHeads : d.mode === 'order' ? rankCount : targeted.length;
  return { ranks, rankCount, maxHeads, ticks, targeted };
}

import type { Fixture } from '~/utils/engine/core/fixture';
import type { ChannelType } from '~/utils/engine/types';

interface ChannelFilter {
  (type: ChannelType, role?: string): boolean;
}

/**
 * Finds the "richest" fixture in the selection for a given channel category.
 * The richest fixture is the one with the most programmed step values and/or
 * the highest sum of values across all category channels.
 */
export function findRichestFixture(fixtures: Fixture[], filter: ChannelFilter): Fixture | null {
  let best: Fixture | null = null;
  let maxScore = -1;

  for (const f of fixtures) {
    let stepsCount = 0;
    let hasNonZero = false;

    for (const c of f.channels) {
      if (!filter(c.type, c.role)) continue;
      stepsCount += c.stepValues.length;
      if (c.stepValues.some(v => v !== 0)) hasNonZero = true;
    }

    const score = (hasNonZero ? 100_000 : 0) + stepsCount;
    if (score > maxScore) {
      maxScore = score;
      best = f;
    }
  }

  return best;
}

/**
 * Copies all category channel state (stepValues + chaserConfig) from `source`
 * to `target` for channels that are "blank" (fewer steps or all zeros).
 *
 * This is intentionally one-directional: we only promote `target` up to `source`'s
 * level, never the other way around. The specific channel value being dragged
 * will be written afterwards by FixturePropertyControl.
 */
export function syncCategoryFromSource(
  target: Fixture,
  source: Fixture,
  filter: ChannelFilter
): void {
  for (const tc of target.channels) {
    if (!filter(tc.type, tc.role)) continue;

    const sc = source.channels.find(
      c => c.type === tc.type && c.oflChannelName === tc.oflChannelName
    ) ?? source.channels.find(c => c.type === tc.type);

    if (!sc) continue;

    // Only sync if target channel is "blank" compared to source
    const targetIsBlank = tc.stepValues.every(v => v === 0) && tc.stepValues.length <= sc.stepValues.length;
    const targetHasFewerSteps = tc.stepValues.length < sc.stepValues.length;

    if (targetIsBlank || targetHasFewerSteps) {
      tc.stepValues = [...sc.stepValues];
      tc.chaserConfig = sc.chaserConfig ? { ...sc.chaserConfig } : undefined;
    }
  }
}

/**
 * Called before a channel value is changed. Ensures all blank fixtures in the
 * selection are promoted to match the richest fixture's category state.
 */
export function syncCategoryBeforeEdit(fixtures: Fixture[], filter: ChannelFilter): void {
  if (fixtures.length <= 1) return;

  const source = findRichestFixture(fixtures, filter);
  if (!source) return;

  for (const f of fixtures) {
    if (f === source) continue;
    syncCategoryFromSource(f, source, filter);
  }
}

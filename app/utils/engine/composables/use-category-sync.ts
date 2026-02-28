import type { Fixture } from '~/utils/engine/core/fixture';
import type { ChannelType } from '~/utils/engine/types';
import type { EffectEngine } from '~/utils/engine/engine';

interface ChannelFilter {
  (type: ChannelType, role?: string): boolean;
}

/**
 * Finds the "richest" fixture in the selection for a given channel category.
 * The richest fixture is the one with the most programmed step values and/or
 * the highest sum of values across all category channels.
 */
export function findRichestFixture(fixtures: Fixture[], filter: ChannelFilter, effectEngine?: EffectEngine): Fixture | null {
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

    let effectCount = 0;
    if (effectEngine) {
      for (const effect of effectEngine.effects) {
        if (effect.targetFixtureIds?.includes(f.id) && effect.targetChannels?.some(t => filter(t))) {
          effectCount++;
        }
      }
    }

    const score = (hasNonZero ? 100_000 : 0) + stepsCount * 100 + effectCount;
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
export type SyncMode = 'steps' | 'modifiers' | 'all';

export function syncCategoryFromSource(
  target: Fixture,
  source: Fixture,
  filter: ChannelFilter,
  effectEngine?: EffectEngine,
  mode: SyncMode = 'all'
): void {
  for (const tc of target.channels) {
    if (!filter(tc.type, tc.role)) continue;

    const sc = source.channels.find(
      c => c.type === tc.type && c.oflChannelName === tc.oflChannelName
    ) ?? source.channels.find(c => c.type === tc.type);

    if (!sc) continue;

    if (mode === 'steps' || mode === 'all') {
      // Always sync target to match source (as requested for overriding)
      tc.stepValues = [...sc.stepValues];
      tc.chaserConfig = sc.chaserConfig ? { ...sc.chaserConfig } : undefined;
    }
  }

  // Sync modifiers
  if (effectEngine && (mode === 'modifiers' || mode === 'all')) {
    // 1. Remove target from any effects that affect the filtered channels
    for (const effect of effectEngine.effects) {
      if (effect.targetFixtureIds?.includes(target.id) && effect.targetChannels?.some(t => filter(t))) {
        effect.targetFixtureIds = effect.targetFixtureIds.filter(id => id !== target.id);
      }
    }

    // 2. Add target to any effects that affect the filtered channels on the source
    for (const effect of effectEngine.effects) {
      if (effect.targetFixtureIds?.includes(source.id) && effect.targetChannels?.some(t => filter(t))) {
        if (!effect.targetFixtureIds.includes(target.id)) {
          effect.targetFixtureIds.push(target.id);
        }
      }
    }

    // Clean up empty effects
    for (let i = effectEngine.effects.length - 1; i >= 0; i--) {
      const e = effectEngine.effects[i];
      if (e && e.targetFixtureIds && e.targetFixtureIds.length === 0) {
        effectEngine.effects.splice(i, 1);
      }
    }
  }
}

/**
 * Called before a channel value is changed. Ensures all blank fixtures in the
 * selection are promoted to match the richest fixture's category state.
 */
export function syncCategoryBeforeEdit(fixtures: Fixture[], filter: ChannelFilter, effectEngine?: EffectEngine, mode: SyncMode = 'all'): void {
  if (fixtures.length <= 1) return;

  const source = findRichestFixture(fixtures, filter, effectEngine);
  if (!source) return;

  for (const f of fixtures) {
    if (f === source) continue;
    syncCategoryFromSource(f, source, filter, effectEngine, mode);
  }
}

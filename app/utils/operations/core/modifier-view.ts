/**
 * The agent view of a modifier instance (WP-L item 4) and its one-line
 * summary (item 6).
 *
 * Every agent-facing output speaks the INPUT vocabulary of
 * `modifiers.add` / `update` — `blend`, `spread`, `speed { mode, value }`,
 * `targets { fixtureIds, channelTypes }` — so an agent can round-trip
 * `modifiers.list` → `modifiers.update`. Used by `modifiers.list`, inspect
 * `modifier:<id>`, the apply diff (`modifier:<id>` entities) and the
 * `state.modifiers` subject of apply expectations. The stored
 * `ModifierInstance` (`blendMode`, `distribution`, `speed.timeMs`, …) is
 * unchanged.
 */
import { z } from 'zod';
import type { DistributionPatch } from '@pixelmapper/extension-api';
import { createDistribution } from '~/utils/engine/distribution/create';
import { modifierName } from '~/utils/engine/modifiers';
import { activePreset } from '~/utils/engine/recipes';
import type { ModifierInstance } from '~/utils/engine/types';
import { getManifest } from '~/utils/plugins/plugin-store';
import type { CoreReadApi } from '../read-api';
import { targetFixtures } from './modifier-build';
import { directionWords, distributionToSpread, speedView, SpeedViewSchema, SpreadViewSchema } from './modifier-spread';
import { FixtureIdSchema, SignatureSchema } from './shared';

// ── View ────────────────────────────────────────

/** A modifier in the operation vocabulary. */
export const ModifierViewSchema = z.object({
  id: z.string(),
  index: z.number().int().describe('Stack position (0 = bottom, evaluated first; the last entry is on top).'),
  plugin: z.object({ hash: z.string(), alias: z.string().nullable(), name: z.string().describe('Display name incl. the first enum option.') }),
  recipe: z.string().nullable().describe('Id of the recipe the params match, or null ("Custom").'),
  signature: SignatureSchema,
  targets: z.object({
    fixtureIds: z.array(FixtureIdSchema).nullable().describe('null = all fixtures.'),
    channelTypes: z.array(z.string()),
  }),
  params: z.record(z.string(), z.unknown()),
  spread: SpreadViewSchema,
  strength: z.number(),
  blend: z.string(),
  speed: SpeedViewSchema,
});

/** Modifier view type. */
export type ModifierView = z.infer<typeof ModifierViewSchema>;

/** View of one instance at stack position `index`. */
export function modifierView(read: CoreReadApi, m: ModifierInstance, index: number): ModifierView {
  const manifest = getManifest(m.plugin);
  const points = targetFixtures(read, m.targetFixtureIds).map(f => ({ id: f.id, x: f.x, y: f.y }));
  return {
    id: m.id,
    index,
    plugin: { hash: m.plugin, alias: manifest?.alias ?? null, name: modifierName(m) },
    recipe: manifest ? activePreset(m, manifest)?.id ?? null : null,
    signature: m.signature,
    targets: { fixtureIds: m.targetFixtureIds ? [...m.targetFixtureIds] : null, channelTypes: [...m.targetChannels] },
    params: m.params as Record<string, unknown>,
    // Defaults fill partial / legacy distributions (missing grouping, order).
    spread: distributionToSpread(createDistribution(m.distribution as DistributionPatch), points),
    strength: m.strength,
    blend: m.blendMode,
    speed: speedView(m.speed),
  };
}

/** Views of the whole stack (bottom first). */
export function modifierViews(read: CoreReadApi): ModifierView[] {
  return read.modifiers().map((m, i) => modifierView(read, m, i));
}

// ── Summary ─────────────────────────────────────

/** Run direction of the spread in compass words (`left→right`), or ''. */
function spreadDirection(m: ModifierInstance): string {
  const d = createDistribution(m.distribution as DistributionPatch);
  if (d.scope !== 'across') return '';
  const flip = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    (d.reverse ? directionWords(a.x - b.x, a.y - b.y) : directionWords(b.x - a.x, b.y - a.y));
  if (d.mode === 'linear') return flip(d.origin, d.end);
  if (d.mode === 'radial') return d.reverse ? 'inward' : 'outward';
  if (d.mode !== 'order') return '';
  if (Object.keys(d.order.ranks).length > 0) return 'by ranks';
  const line = d.order.line;
  if (!line) return '';
  return d.order.mirror ? 'center-out' : flip(line.a, line.b);
}

/** Speed in words (`8 beats/cycle`, `2 s/cycle`, `frozen`). */
function speedWords(view: ModifierView): string {
  if (view.speed.mode === 'infinite') return 'frozen';
  return view.speed.mode === 'beat' ? `${view.speed.value} beat${view.speed.value === 1 ? '' : 's'}/cycle` : `${view.speed.value} s/cycle`;
}

/**
 * One line describing a modifier, e.g. `Waveform · chase · scalar DIMMER ·
 * 21 fixtures · order left→right · 8 beats/cycle · blend add`.
 */
export function modifierSummary(m: ModifierInstance, view: ModifierView): string {
  const spread = [view.spread.type, view.spread.type === 'spatial' ? view.spread.mode : '', spreadDirection(m)].filter(Boolean).join(' ');
  const targets = view.targets.fixtureIds ? `${view.targets.fixtureIds.length} fixture${view.targets.fixtureIds.length === 1 ? '' : 's'}` : 'all fixtures';
  const channels = view.signature === 'scalar' ? ` ${view.targets.channelTypes.join('/')}` : '';
  return [
    view.plugin.name,
    view.recipe,
    `${view.signature}${channels}`,
    targets,
    spread,
    speedWords(view),
    `blend ${view.blend}`,
    view.strength < 1 ? `strength ${view.strength}` : null,
  ].filter(Boolean).join(' · ');
}

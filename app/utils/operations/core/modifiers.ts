/**
 * Modifier operations: `modifiers.list`, `modifiers.add`, `modifiers.update`,
 * `modifiers.remove`, `modifiers.reorder`, `modifiers.applyRecipe`
 * (ADR 0002 §4.2, amendment B3).
 *
 * They speak the vocabulary of the modifier card (plugin alias, recipe,
 * params, spread, strength, blend, speed) and translate it with the card
 * helpers (`createModifier`, `applyPreset`, `selectionDistribution`). Every
 * mutation returns ONE `SetModifiersCommand` (before = current list, after =
 * new list); nothing is mutated in `run`.
 *
 * Coordinates are normalized world space 0–1 (x left→right, y top→bottom on
 * the 2D canvas, the same space as plugin `Sample.x/y`).
 */
import { z } from 'zod';
import { SetModifiersCommand } from '~/components/engine/commands/set-modifiers-command';
import { useEngineStore } from '~/stores/engine-store';
import { cloneModifiers, modifierName } from '~/utils/engine/modifiers';
import { activePreset } from '~/utils/engine/recipes';
import type { ModifierInstance } from '~/utils/engine/types';
import { getManifest } from '~/utils/plugins/plugin-store';
import { defineCoreOperation } from '../define';
import type { CoreReadApi } from '../read-api';
import type { CoreOperation } from '../registry';
import { buildInstance, instanceFindings, InstanceFieldsSchema, patchInstance, targetFixtures, withRecipe } from './modifier-build';
import { distributionToSpread, speedView, SpeedViewSchema, SpreadViewSchema } from './modifier-spread';
import { PluginRefSchema, requirePlugin } from './plugin-ref';
import { FixtureIdSchema, SignatureSchema } from './shared';

// ── Helpers ─────────────────────────────────────

/** Modifier id input. */
const ModifierIdSchema = z.string().min(1).describe('Modifier instance id (see modifiers.list).');

/** Readable "not found" message. */
function modifierNotFound(id: string): string {
  return `modifier "${id}" not found (use modifiers.list to list ids)`;
}

/** One `SetModifiersCommand` from the current list to `after`. */
function setModifiers(after: ModifierInstance[], description: string): SetModifiersCommand {
  const store = useEngineStore();
  return new SetModifiersCommand(store.engine, cloneModifiers(store.modifiers), after, description);
}

/** Display name of a plugin for undo labels. */
function pluginName(hash: string): string {
  return getManifest(hash)?.name ?? 'Modifier';
}

/** Findings of the instance `id` after the op (missing = error). */
function verifyInstance(read: CoreReadApi, id: string): ReturnType<typeof instanceFindings> {
  const m = read.modifier(id);
  return m ? instanceFindings(read, m) : [{ level: 'error', code: 'modifier-missing', message: `modifier "${id}" is not in the stack after the operation` }];
}

// ── View ────────────────────────────────────────

/** A modifier in the operation vocabulary. */
const ModifierViewSchema = z.object({
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

/** View of one instance. */
function modifierView(read: CoreReadApi, m: ModifierInstance, index: number): z.infer<typeof ModifierViewSchema> {
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
    spread: distributionToSpread(m.distribution, points),
    strength: m.strength,
    blend: m.blendMode,
    speed: speedView(m.speed),
  };
}

// ── Shared description parts ────────────────────

/** How targets / spread / speed work (appended to add and update). */
const FIELD_DOCS = [
  'targets: { fixtureIds?, groupIds?, signature?, channelTypes? } — groups expand to their fixtures; omit ids to target every fixture offering the signature. signature: rgb (color), panTilt (movement), scalar (single channels such as DIMMER).',
  'spread (the card\'s "Spread" dropdown): { type: "same" } all fixtures equal | { type: "spatial", mode?: linear|radial|conical, origin?: {x,y}, end?: {x,y}, reverse? } a gradient across the room in normalized world coords 0–1 (x left→right, y top→bottom; default handle = the targets\' main axis) | { type: "order", ranks?: { [fixtureId]: rank 0.. } or fixtureOrder?: [ids in run order], reverse? } fixture by fixture (default order = along the targets\' main axis) | { type: "within", offset?: none|order } over the heads/pixels inside each fixture.',
  'speed: { mode: "beat", value: beats per cycle (1 = one beat, 4 = one bar), beatOffset? } | { mode: "time", value: seconds per cycle } | { mode: "infinite" } (frozen). strength 0–1. blend: add | override | multiply | max | min.',
  'params: partial values by key, validated against the plugin\'s param schema (plugins.get lists keys, types, ranges and enum options).',
].join('\n');

// ── Query ───────────────────────────────────────

/** `modifiers.list`. */
export const modifiersList = defineCoreOperation({
  id: 'modifiers.list',
  kind: 'query',
  description: [
    'List the modifier stack in order (index 0 = bottom, evaluated first; the last entry is on top).',
    'Each entry: id, plugin (hash, alias, display name), recipe (matching recipe id or null = custom), signature, targets (fixture ids, null = all; channel types), params, spread (same | spatial with origin/end in normalized world 0–1 | order with effective ranks by fixture id, 0 = first | within), strength 0–1, blend mode and speed (beat: beats per cycle; time: seconds per cycle).',
    'Optional filters: plugin (alias/hash) and fixtureId (modifiers targeting that fixture).',
  ].join('\n'),
  input: z.object({
    plugin: PluginRefSchema.optional(),
    fixtureId: FixtureIdSchema.optional().describe('Only modifiers that target this fixture.'),
  }),
  output: z.object({ modifiers: z.array(ModifierViewSchema) }),
  examples: [{ input: {}, note: 'The whole stack.' }, { input: { fixtureId: 'fx-1' }, note: 'Modifiers acting on one fixture.' }],
  async run(ctx, input) {
    const hash = input.plugin ? (await requirePlugin(input.plugin)).hash : null;
    const views = ctx.read.modifiers()
      .map((m, i) => modifierView(ctx.read, m, i))
      .filter(v => !hash || v.plugin.hash === hash)
      .filter(v => input.fixtureId === undefined || !v.targets.fixtureIds || v.targets.fixtureIds.map(String).includes(String(input.fixtureId)));
    return { kind: 'query', value: { modifiers: views } };
  },
});

// ── Mutations ───────────────────────────────────

/** `modifiers.add`. */
export const modifiersAdd = defineCoreOperation({
  id: 'modifiers.add',
  kind: 'mutation',
  description: [
    'Add a modifier (an effect layer such as Waveform, Noise, Sequencer or Color Shift) to the stack, like "Add" on the modifier card.',
    'Starts from the recipe you name (`recipe`, see plugins.get) or the one the card would pick for the targets, placed on the targets; then applies params, spread, strength, blend and speed. Default position: top of the stack (`index` to insert elsewhere, 0 = bottom). Returns the new modifierId.',
    FIELD_DOCS,
  ].join('\n'),
  input: InstanceFieldsSchema.extend({
    plugin: PluginRefSchema,
    recipe: z.string().optional().describe('Recipe id or label of the plugin (e.g. "chase", "candle"); default = the card\'s pick for the targets.'),
    index: z.number().int().min(0).optional().describe('Stack position to insert at (0 = bottom); default = top.'),
  }),
  output: z.object({ modifierId: z.string() }),
  produces: ['SetModifiers'],
  examples: [
    { input: { plugin: 'waveform', recipe: 'chase', targets: { groupIds: ['truss'] }, speed: { mode: 'beat', value: 4 } }, note: 'A chase over a group, one pass per bar.' },
    { input: { plugin: 'colorAdjust', spread: { type: 'spatial', mode: 'linear', origin: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } } }, note: 'Color Shift sweeping left→right over all color fixtures.' },
    { input: { plugin: 'noise', recipe: 'candle', targets: { fixtureIds: ['fx-1', 'fx-2'] }, params: { rangeMin: 0.3 }, strength: 0.8 } },
    { input: { plugin: 'waveform', spread: { type: 'order', fixtureOrder: ['fx-3', 'fx-1', 'fx-2'] } }, note: 'Chase in an explicit fixture order.' },
  ],
  async run(ctx, input) {
    const plugin = await requirePlugin(input.plugin);
    const inst = buildInstance(ctx.read, plugin, input);
    const after = cloneModifiers(useEngineStore().modifiers);
    after.splice(Math.min(input.index ?? after.length, after.length), 0, inst);
    return { kind: 'mutation', commands: [setModifiers(after, `Add ${plugin.manifest.name}`)], value: { modifierId: inst.id } };
  },
  verify: (ctx, _input, value) => verifyInstance(ctx.read, value.modifierId),
});

/** `modifiers.update`. */
export const modifiersUpdate = defineCoreOperation({
  id: 'modifiers.update',
  kind: 'mutation',
  description: [
    'Change fields of an existing modifier; omitted fields stay. params are merged by key (only the given keys change); speed merges too (omit value to keep it).',
    'targets replace the target fixtures when fixtureIds/groupIds are given. spread switches like the card\'s dropdown: other distribution fields (handle, ranks) are kept unless given. To change the plugin, remove and add.',
    FIELD_DOCS,
  ].join('\n'),
  input: InstanceFieldsSchema.extend({ modifierId: ModifierIdSchema }),
  output: z.object({ modifierId: z.string() }),
  produces: ['SetModifiers'],
  examples: [
    { input: { modifierId: 'mod-1', params: { invert: true }, speed: { mode: 'beat', value: 2 } } },
    { input: { modifierId: 'mod-1', spread: { type: 'spatial', mode: 'radial' } }, note: 'Radial from the targets\' center.' },
    { input: { modifierId: 'mod-1', targets: { groupIds: ['left-wall'] } } },
  ],
  run(ctx, input) {
    const current = ctx.read.modifier(input.modifierId);
    if (!current) throw new Error(modifierNotFound(input.modifierId));
    const next = patchInstance(ctx.read, current, input);
    const after = cloneModifiers(useEngineStore().modifiers).map(m => (m.id === next.id ? next : m));
    return { kind: 'mutation', commands: [setModifiers(after, `Update ${pluginName(current.plugin)}`)], value: { modifierId: current.id } };
  },
  verify: (ctx, input) => verifyInstance(ctx.read, input.modifierId),
});

/** `modifiers.remove`. */
export const modifiersRemove = defineCoreOperation({
  id: 'modifiers.remove',
  kind: 'mutation',
  description: 'Remove modifiers from the stack by id (the whole instance, for all its target fixtures). Unknown ids fail the operation.',
  input: z.object({ modifierIds: z.array(ModifierIdSchema).min(1) }),
  output: z.object({ removed: z.array(z.string()) }),
  produces: ['SetModifiers'],
  examples: [{ input: { modifierIds: ['mod-1'] } }],
  run(ctx, input) {
    const ids = new Set(input.modifierIds);
    for (const id of ids) if (!ctx.read.modifier(id)) throw new Error(modifierNotFound(id));
    const after = cloneModifiers(useEngineStore().modifiers).filter(m => !ids.has(m.id));
    const label = ids.size === 1 ? 'Remove Modifier' : `Remove ${ids.size} Modifiers`;
    return { kind: 'mutation', commands: [setModifiers(after, label)], value: { removed: [...ids] } };
  },
});

/** `modifiers.reorder`. */
export const modifiersReorder = defineCoreOperation({
  id: 'modifiers.reorder',
  kind: 'mutation',
  description: [
    'Reorder the modifier stack. `order` is the complete new order: every modifier id exactly once, bottom (evaluated first) to top.',
    'Later layers combine with earlier ones by their blend mode, so an override layer on top hides the layers below it.',
  ].join('\n'),
  input: z.object({ order: z.array(ModifierIdSchema).min(1).describe('All modifier ids in the new order (index 0 = bottom).') }),
  output: z.object({ order: z.array(z.string()) }),
  produces: ['SetModifiers'],
  examples: [{ input: { order: ['mod-2', 'mod-1'] }, note: 'Swap a two-layer stack.' }],
  run(_ctx, input) {
    const current = cloneModifiers(useEngineStore().modifiers);
    const byId = new Map(current.map(m => [m.id, m]));
    const unique = new Set(input.order);
    if (unique.size !== input.order.length) throw new Error('order lists an id more than once');
    const unknown = input.order.filter(id => !byId.has(id));
    if (unknown.length) throw new Error(`unknown modifier ids: ${unknown.join(', ')}`);
    const missing = current.filter(m => !unique.has(m.id)).map(m => m.id);
    if (missing.length) throw new Error(`order must list every modifier; missing: ${missing.join(', ')}`);
    const after = input.order.map(id => byId.get(id)!);
    return { kind: 'mutation', commands: [setModifiers(after, 'Reorder Modifiers')], value: { order: [...input.order] } };
  },
});

/** `modifiers.applyRecipe`. */
export const modifiersApplyRecipe = defineCoreOperation({
  id: 'modifiers.applyRecipe',
  kind: 'mutation',
  description: [
    'Apply one of the plugin\'s recipes (named complete looks, see plugins.get) to an existing modifier, like clicking it in the card\'s preset bar.',
    'Replaces all params, and the speed / spread / strength fields the recipe sets; targets, blend and the remaining fields stay. When the recipe changes the spread mode, its handle and order are placed on the modifier\'s targets.',
  ].join('\n'),
  input: z.object({
    modifierId: ModifierIdSchema,
    recipe: z.string().min(1).describe('Recipe id or label (e.g. "ping-pong", "Center Out").'),
  }),
  output: z.object({ modifierId: z.string(), recipe: z.string() }),
  produces: ['SetModifiers'],
  examples: [{ input: { modifierId: 'mod-1', recipe: 'ping-pong' } }],
  run(ctx, input) {
    const current = ctx.read.modifier(input.modifierId);
    if (!current) throw new Error(modifierNotFound(input.modifierId));
    const { instance: next, recipeId: recipe } = withRecipe(ctx.read, current, input.recipe);
    const after = cloneModifiers(useEngineStore().modifiers).map(m => (m.id === next.id ? next : m));
    return { kind: 'mutation', commands: [setModifiers(after, `Apply Recipe ${input.recipe}`)], value: { modifierId: current.id, recipe } };
  },
  verify: (ctx, input) => verifyInstance(ctx.read, input.modifierId),
});

/** All modifier operations. */
export const modifierOperations: CoreOperation[] = [modifiersList, modifiersAdd, modifiersUpdate, modifiersRemove, modifiersReorder, modifiersApplyRecipe];

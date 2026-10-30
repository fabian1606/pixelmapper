/**
 * Modifier operations: `modifiers.list`, `modifiers.add`, `modifiers.update`,
 * `modifiers.remove`, `modifiers.reorder`, `modifiers.applyRecipe`
 * (ADR 0002 §4.2, amendment B3), plus the `modifiers.trigger` action.
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
import { cloneModifiers, duplicateModifierIds } from '~/utils/engine/modifiers';
import type { ModifierInstance } from '~/utils/engine/types';
import { getManifest } from '~/utils/plugins/plugin-store';
import { defineCoreOperation } from '../define';
import type { CoreReadApi } from '../read-api';
import type { CoreOperation } from '../registry';
import { buildInstance, instanceFindings, InstanceFieldsSchema, patchInstance, withRecipe } from './modifier-build';
import { BaseColorSchema, baseColorCommands, type BaseColorResult } from './modifier-color';
import { darkTargetFindings } from './modifier-dark';
import { modifiersTrigger } from './modifier-trigger';
import { modifierView, ModifierViewSchema } from './modifier-view';
import { PluginRefSchema, requirePlugin } from './plugin-ref';
import { FixtureIdSchema, modifierAmbiguous, ModifierIdSchema, requireModifier } from './shared';

// ── Helpers ─────────────────────────────────────

/** A caller-chosen id (letters, digits, `-`, `_`). */
export const ClientIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'use 1–64 letters, digits, "-" or "_"');

/** Modifier id list input (`modifierIds`; a single `modifierId` / `id` is accepted as alias). */
const ModifierIdListSchema = z.array(ModifierIdSchema, {
  error: iss => (iss.input === undefined ? 'required: pass `modifierIds` (or a single `modifierId` / `id` as alias): the modifier instance ids from modifiers.list' : undefined),
}).min(1);

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

/** End-of-batch check: the instance would stay dark on a zero base (`dark-base` warnings). */
function verifyLit(read: CoreReadApi, id: string): ReturnType<typeof instanceFindings> {
  const m = read.modifier(id);
  return m ? darkTargetFindings(read, m) : [];
}

/** Info finding describing what the `color` option wrote. */
function baseColorInfo(id: string, base: BaseColorResult | undefined): ReturnType<typeof instanceFindings> {
  if (!base) return [];
  const raised = base.dimmerRaised.length ? `; DIMMER base 0 → full on ${base.dimmerRaised.length}` : '';
  return [{ level: 'info', code: 'base-color-set', message: `base color ${base.color} set on ${base.fixtureIds.length} fixture(s)${raised}`, entityIds: [`modifier:${id}`] }];
}

/** Output of `modifiers.add` / `update`. */
const InstanceOutputSchema = z.object({
  modifierId: z.string(),
  baseColor: z.object({
    color: z.string(),
    fixtureIds: z.array(z.string()),
    dimmerRaised: z.array(z.string()).describe('Fixtures whose DIMMER base was 0 and is now full.'),
  }).optional().describe('Present when `color` was given.'),
});

// ── View ────────────────────────────────────────

/** A modifier id several instances share (see `duplicateIdWarnings`). */
const DuplicateIdSchema = z.object({ id: z.string(), count: z.number().int().describe('Number of instances sharing the id.') });

/**
 * Readable warnings for ids several instances share: the agent sees them in
 * the `modifiers.list` output (ops addressing such an id fail as ambiguous).
 */
function duplicateIdWarnings(duplicates: Map<string, number>): string[] {
  return [...duplicates].map(([id, count]) =>
    `modifier id "${id}" is shared by ${count} instances (inconsistent stack): ops addressing "${id}" fail as ambiguous until the project is reloaded (the load repair gives the duplicates fresh ids) or the instances are removed and re-added`);
}

// ── Shared description parts ────────────────────

/** Blend semantics per output kind (plugins.get shows a plugin's output). */
const BLEND_DOCS = [
  'blend — how the layer combines with the value below it (base = programmed value, see channels.set):',
  '  scale output (Waveform, Noise, Sequencer; level = base × (1 − strength + strength × wave)): add (default) = apply the dimming to what is below | override = replace what is below with the dimmed base | multiply = multiply what is below by the level (stacked dimming) | max / min = brighter / darker of the two. A base of 0 stays 0: set the dimmer/color first (`color` option or channels.set).',
  '  absolute output (Color Shift, Corner Wave; sets values itself): override (default) = replace | add = add on top | multiply = filter what is below | max / min = brighter / darker of the two; strength mixes the result in.',
].join('\n');

/** How targets / spread / speed work (appended to add and update). */
const FIELD_DOCS = [
  'targets: { fixtureIds?, groupIds?, signature?, channelTypes? } — groups expand to their fixtures; omit ids to target every fixture offering the signature. signature: rgb (color), panTilt (movement), scalar (single channels such as DIMMER).',
  'spread (the card\'s "Spread" dropdown): { type: "same" } all fixtures equal | { type: "spatial", mode?: linear|radial|conical, direction?, origin?: {x,y}, end?: {x,y}, reverse? } a gradient across the room in normalized world coords 0–1 (x left→right, y top→bottom) | { type: "order", direction?, ranks?: { [fixtureId]: rank 0.. } or fixtureOrder?: [ids in run order], reverse? } fixture by fixture | { type: "within", offset?: none|order } over the heads/pixels inside each fixture.',
  'Direction: chases and gradients run LEFT→RIGHT along x by default (fixtures with the same x move together; top→bottom when all targets share one x). Choose another with direction: "left-to-right" | "right-to-left" | "top-to-bottom" | "bottom-to-top", or exact origin/end, fixtureOrder/ranks; reverse flips it.',
  'speed: { mode: "beat", value: beats per cycle (1 = one beat, 4 = one bar), beatOffset? } | { mode: "time", value: seconds per cycle } | { mode: "infinite" } (frozen). Every speed key is optional and merged onto the current speed (add: the recipe\'s): { value: 2 } keeps the mode, { mode: "time" } keeps the stored seconds; value is invalid in infinite mode. strength 0–1.',
  BLEND_DOCS,
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
    'If several instances share one id, the output also has duplicateIds ({ id, count }) and warnings; ops addressing such an id fail as ambiguous.',
  ].join('\n'),
  input: z.object({
    plugin: PluginRefSchema.optional(),
    fixtureId: FixtureIdSchema.optional().describe('Only modifiers that target this fixture.'),
  }),
  output: z.object({
    warnings: z.array(z.string()).optional().describe('Present only when the stack is inconsistent (duplicate ids).'),
    duplicateIds: z.array(DuplicateIdSchema).optional().describe('Ids shared by several instances (whole stack, ignoring filters).'),
    modifiers: z.array(ModifierViewSchema),
  }),
  examples: [{ input: {}, note: 'The whole stack.' }, { input: { fixtureId: 'fx-1' }, note: 'Modifiers acting on one fixture.' }],
  async run(ctx, input) {
    const hash = input.plugin ? (await requirePlugin(input.plugin)).hash : null;
    const all = ctx.read.modifiers();
    const views = all
      .map((m, i) => modifierView(ctx.read, m, i))
      .filter(v => !hash || v.plugin.hash === hash)
      .filter(v => input.fixtureId === undefined || !v.targets.fixtureIds || v.targets.fixtureIds.map(String).includes(String(input.fixtureId)));
    // Duplicate ids are checked on the whole stack, independent of the filters.
    const duplicates = duplicateModifierIds(all);
    if (duplicates.size === 0) return { kind: 'query', value: { modifiers: views } };
    return {
      kind: 'query',
      value: {
        warnings: duplicateIdWarnings(duplicates),
        duplicateIds: [...duplicates].map(([id, count]) => ({ id, count })),
        modifiers: views,
      },
    };
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
    'COLOR: Waveform / Noise / Sequencer are scalar (they dim the DIMMER); the color you see is the fixtures\' base color. For a colored chase or pulse pass `color: "#rrggbb"` (sets the targets\' base color and raises a zero DIMMER to full, same undo step): a slow blue chase = { plugin: "waveform", recipe: "chase", color: "#0000ff", speed: { mode: "beat", value: 8 } }. A modifier that would stay dark (DIMMER or color base 0) gets a `dark-base` warning with the fix.',
    FIELD_DOCS,
  ].join('\n'),
  input: InstanceFieldsSchema.extend({
    plugin: PluginRefSchema,
    recipe: z.string().optional().describe('Recipe id or label of the plugin (e.g. "chase", "candle"); default = the card\'s pick for the targets.'),
    index: z.number().int().min(0).optional().describe('Stack position to insert at (0 = bottom); default = top.'),
    color: BaseColorSchema.optional(),
    id: ClientIdSchema.optional().describe('Choose the new modifier id yourself (e.g. "ai-corner-wave") so later ops in the SAME apply batch (live.addWidget effect-param mappings) can reference it; the whole batch stays one undo step. Must not exist yet. Default: a generated id.'),
  }),
  output: InstanceOutputSchema,
  produces: ['SetModifiers', 'SetChannelValues'],
  examples: [
    { input: { plugin: 'waveform', recipe: 'chase', color: '#0000ff', speed: { mode: 'beat', value: 8 } }, note: 'A slow blue chase over every fixture, left→right, one pass per two bars.' },
    { input: { plugin: 'waveform', recipe: 'chase', targets: { groupIds: ['truss'] }, speed: { mode: 'beat', value: 4 } }, note: 'A chase over a group, one pass per bar (keeps the base color).' },
    { input: { plugin: 'waveform', recipe: 'chase', spread: { type: 'order', direction: 'right-to-left' } }, note: 'Chase running right→left.' },
    { input: { plugin: 'colorAdjust', spread: { type: 'spatial', mode: 'linear', origin: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } } }, note: 'Color Shift sweeping left→right over all color fixtures.' },
    { input: { plugin: 'noise', recipe: 'candle', targets: { fixtureIds: ['fx-1', 'fx-2'] }, params: { rangeMin: 0.3 }, strength: 0.8 } },
    { input: { plugin: 'waveform', spread: { type: 'order', fixtureOrder: ['fx-3', 'fx-1', 'fx-2'] } }, note: 'Chase in an explicit fixture order.' },
    { input: { plugin: '@pixelmapper/corner-wave', id: 'ai-corner-wave', params: { a: { x: 0.3, y: 0.3 } } }, note: 'Own id, so a live.addWidget in the same batch can map a slider to it.' },
  ],
  async run(ctx, input) {
    if (input.id !== undefined && ctx.read.modifier(input.id)) throw new Error(`modifier id "${input.id}" already exists; choose another id or omit it`);
    const plugin = await requirePlugin(input.plugin);
    const inst = buildInstance(ctx.read, plugin, input);
    if (input.id !== undefined) inst.id = input.id;
    const after = cloneModifiers(useEngineStore().modifiers);
    after.splice(Math.min(input.index ?? after.length, after.length), 0, inst);
    const color = input.color ? baseColorCommands(ctx.read, inst.targetFixtureIds ?? ctx.read.fixtures().map(f => f.id), input.color) : null;
    return {
      kind: 'mutation',
      commands: [...(color?.commands ?? []), setModifiers(after, `Add ${plugin.manifest.name}`)],
      value: { modifierId: inst.id, ...(color ? { baseColor: color.result } : {}) },
    };
  },
  verify: (ctx, _input, value) => [...verifyInstance(ctx.read, value.modifierId), ...baseColorInfo(value.modifierId, value.baseColor)],
  verifyAfterBatch: (ctx, _input, value) => verifyLit(ctx.read, value.modifierId),
});

/** `modifiers.update`. */
export const modifiersUpdate = defineCoreOperation({
  id: 'modifiers.update',
  kind: 'mutation',
  description: [
    'Change fields of an existing modifier (`modifierId`, alias `id`); omitted fields stay. params merge by key; speed merges too (any subset of mode / value / beatOffset, e.g. { value: 2 } keeps the mode).',
    'targets replace the target fixtures when fixtureIds/groupIds are given. spread switches like the card\'s dropdown: other distribution fields (handle, ranks) are kept unless given. To change the plugin, remove and add.',
    FIELD_DOCS,
  ].join('\n'),
  input: InstanceFieldsSchema.extend({ modifierId: ModifierIdSchema, color: BaseColorSchema.optional() }),
  output: InstanceOutputSchema,
  produces: ['SetModifiers', 'SetChannelValues'],
  examples: [
    { input: { modifierId: 'mod-1', params: { invert: true }, speed: { mode: 'beat', value: 2 } } },
    { input: { modifierId: 'mod-1', speed: { value: 8 } }, note: 'Slower: 8 per cycle in the current mode (beats or seconds).' },
    { input: { modifierId: 'mod-1', spread: { type: 'spatial', mode: 'radial' } }, note: 'Radial from the targets\' center.' },
    { input: { modifierId: 'mod-1', targets: { groupIds: ['left-wall'] } } },
    { input: { modifierId: 'mod-1', color: '#ff0000' }, note: 'Recolor a chase: sets the targets\' base color.' },
  ],
  run(ctx, input) {
    const current = requireModifier(ctx.read, input.modifierId);
    const next = patchInstance(ctx.read, current, input);
    const after = cloneModifiers(useEngineStore().modifiers).map(m => (m.id === next.id ? next : m));
    const color = input.color ? baseColorCommands(ctx.read, next.targetFixtureIds ?? ctx.read.fixtures().map(f => f.id), input.color) : null;
    return {
      kind: 'mutation',
      commands: [...(color?.commands ?? []), setModifiers(after, `Update ${pluginName(current.plugin)}`)],
      value: { modifierId: current.id, ...(color ? { baseColor: color.result } : {}) },
    };
  },
  verify: (ctx, input, value) => [...verifyInstance(ctx.read, input.modifierId), ...baseColorInfo(input.modifierId, value.baseColor)],
  verifyAfterBatch: (ctx, input) => verifyLit(ctx.read, input.modifierId),
});

/** `modifiers.remove`. */
export const modifiersRemove = defineCoreOperation({
  id: 'modifiers.remove',
  kind: 'mutation',
  description: 'Remove modifiers from the stack by id (the whole instance, for all its target fixtures). Pass `modifierIds` (a single `modifierId` or `id` is accepted as alias; several keys must name the same ids). Unknown ids fail the operation.',
  input: z.object({ modifierIds: ModifierIdListSchema.describe('Ids to remove. Alias: a single "modifierId" or "id".') }),
  output: z.object({ removed: z.array(z.string()) }),
  produces: ['SetModifiers'],
  examples: [{ input: { modifierIds: ['mod-1'] } }],
  run(ctx, input) {
    const ids = new Set(input.modifierIds);
    for (const id of ids) requireModifier(ctx.read, id);
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
    // A shared id cannot name one stack position: refuse instead of dropping an instance.
    const [ambiguous] = duplicateModifierIds(current);
    if (ambiguous) throw new Error(modifierAmbiguous(ambiguous[0], ambiguous[1]));
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
    'Address the modifier with `modifierId` (alias `id`).',
  ].join('\n'),
  input: z.object({
    modifierId: ModifierIdSchema,
    recipe: z.string().min(1).describe('Recipe id or label (e.g. "ping-pong", "Center Out").'),
  }),
  output: z.object({ modifierId: z.string(), recipe: z.string() }),
  produces: ['SetModifiers'],
  examples: [{ input: { modifierId: 'mod-1', recipe: 'ping-pong' } }],
  run(ctx, input) {
    const current = requireModifier(ctx.read, input.modifierId);
    const { instance: next, recipeId: recipe } = withRecipe(ctx.read, current, input.recipe);
    const after = cloneModifiers(useEngineStore().modifiers).map(m => (m.id === next.id ? next : m));
    return { kind: 'mutation', commands: [setModifiers(after, `Apply Recipe ${input.recipe}`)], value: { modifierId: current.id, recipe } };
  },
  verify: (ctx, input) => verifyInstance(ctx.read, input.modifierId),
  verifyAfterBatch: (ctx, input) => verifyLit(ctx.read, input.modifierId),
});

/** All modifier operations (`modifiers.trigger` lives in `modifier-trigger.ts`). */
export const modifierOperations: CoreOperation[] = [modifiersList, modifiersAdd, modifiersUpdate, modifiersRemove, modifiersReorder, modifiersApplyRecipe, modifiersTrigger];

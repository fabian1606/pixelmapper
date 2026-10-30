/**
 * Building and checking modifier instances for the `modifiers.*` operations
 * (ADR 0002 B3). Mirrors the card's add flow (`useChaserModifiers.newInstance`):
 * host defaults → recipe picked for (or named for) the targets and placed on
 * them → params (with `optionDistribution`) → spread → strength / blend /
 * speed. All functions are pure with respect to the stores: they return new
 * instances and never mutate the live modifier list.
 */
import { z } from 'zod';
import type { Finding } from '@pixelmapper/agent-kit';
import type { ContentPluginManifest, ManifestPreset } from '@pixelmapper/plugin-toolchain/types';
import { useEngineStore } from '~/stores/engine-store';
import type { Fixture } from '~/utils/engine/core/fixture';
import { CHANNEL_CATEGORIES } from '~/utils/engine/channel-categories';
import { analyzeSelection, type SelectionShape } from '~/utils/engine/distribution/selection-shape';
import { selectionDistribution } from '~/utils/engine/distribution/selection-defaults';
import { hasSaturatedColor } from '~/utils/engine/fixture-color';
import { cloneModifier, createModifier } from '~/utils/engine/modifiers';
import { distributionForParams } from '~/utils/engine/option-distribution';
import { applyPreset, applyPresetOnSelection, cardPresets, pickPreset } from '~/utils/engine/recipes';
import type { BlendMode, ChannelType, ModifierInstance, Signature } from '~/utils/engine/types';
import { getManifest } from '~/utils/plugins/plugin-store';
import type { CoreReadApi, FixtureInfo } from '../read-api';
import { paramProblems } from './modifier-params';
import { applySpeed, SpeedSchema, SpreadSchema, spreadToDistribution } from './modifier-spread';
import { FixtureIdSchema, SignatureSchema } from './shared';

// ── Schemas ─────────────────────────────────────

/** Blend modes of the stack. */
export const BlendSchema = z.enum(['add', 'override', 'multiply', 'max', 'min'])
  .describe('How the output combines with the layers below: add (default for modulating plugins), override (default for absolute plugins like Color Shift), multiply, max, min.');

/** Modifier targets. */
export const TargetsSchema = z.object({
  fixtureIds: z.array(FixtureIdSchema).optional().describe('Target fixtures (see fixtures.find).'),
  groupIds: z.array(FixtureIdSchema).optional().describe('Target groups; all fixtures inside (deep) are added to fixtureIds.'),
  signature: SignatureSchema.optional()
    .describe('Value space: rgb (color), panTilt (movement), scalar (single channels). Must be one the plugin supports; default = the plugin\'s first signature that the targets offer.'),
  channelTypes: z.array(z.string()).optional()
    .describe('Scalar signature only: channel types to drive, e.g. ["DIMMER"] or ["STROBE"]. Default: DIMMER (rgb: the color channels, panTilt: PAN/TILT).'),
}).describe('Which fixtures the modifier acts on. Omit fixtureIds and groupIds to target every fixture offering the signature (stored as an explicit id list).');

/** Fields shared by `modifiers.add` and `modifiers.update`. */
export const InstanceFieldsSchema = z.object({
  targets: TargetsSchema.optional(),
  params: z.record(z.string(), z.unknown()).optional()
    .describe('Plugin params by key (partial; see plugins.get for keys, types and ranges). Merged over the recipe / current values.'),
  spread: SpreadSchema.optional(),
  strength: z.number().min(0).max(1).optional().describe('Effect amount 0–1 (1 = full).'),
  blend: BlendSchema.optional(),
  speed: SpeedSchema.optional(),
});

/** Instance field input type. */
export type InstanceFields = z.infer<typeof InstanceFieldsSchema>;

// ── Targets ─────────────────────────────────────

/** Resolved targets of an instance. */
export interface ResolvedTargets {
  ids: Array<string | number>;
  signature: Signature;
  targetChannels: ChannelType[];
  /** Target fixtures (compact views), for selection shape and ranks. */
  fixtures: FixtureInfo[];
}

/** Category channel types per non-scalar signature. */
const SIGNATURE_CHANNELS: Record<Exclude<Signature, 'scalar'>, readonly ChannelType[]> = {
  rgb: CHANNEL_CATEGORIES.find(c => c.id === 'color')!.types,
  panTilt: CHANNEL_CATEGORIES.find(c => c.id === 'position')!.types,
};

/** Default target channels: the signature's category channels present on the fixtures (scalar: DIMMER). */
function defaultChannels(signature: Signature, fixtures: readonly FixtureInfo[]): ChannelType[] {
  const present = new Set(fixtures.flatMap(f => f.channelTypes));
  if (signature === 'scalar') return present.has('DIMMER') || fixtures.length === 0 ? ['DIMMER'] : [];
  return SIGNATURE_CHANNELS[signature].filter(t => present.has(t));
}

/** True when the fixture can be driven by the signature (scalar: has one of the channels). */
export function offers(f: FixtureInfo, signature: Signature, channels: readonly ChannelType[]): boolean {
  if (!f.signatures.includes(signature)) return false;
  return signature !== 'scalar' || channels.some(c => f.channelTypes.includes(c));
}

/** Fixture views of stored target ids (undefined = all fixtures). */
export function targetFixtures(read: CoreReadApi, ids: ModifierInstance['targetFixtureIds']): FixtureInfo[] {
  const all = read.fixtures();
  if (!ids) return all;
  const wanted = new Set(ids.map(String));
  return all.filter(f => wanted.has(String(f.id)));
}

/** Expands explicit fixture / group ids to stored fixture ids; throws on unknown ids. */
function explicitIds(read: CoreReadApi, targets: z.infer<typeof TargetsSchema>): Array<string | number> {
  const fixtures = read.fixtures();
  const out = new Map<string, string | number>();
  for (const raw of targets.fixtureIds ?? []) {
    const f = fixtures.find(x => String(x.id) === String(raw));
    if (!f) throw new Error(`fixture "${String(raw)}" not found (use fixtures.find to list ids)`);
    out.set(String(f.id), f.id);
  }
  const groups = read.groups();
  for (const raw of targets.groupIds ?? []) {
    const g = groups.find(x => String(x.id) === String(raw));
    if (!g) throw new Error(`group "${String(raw)}" not found (groups are listed by the project digest)`);
    for (const id of g.fixtureIds) out.set(String(id), id);
  }
  return [...out.values()];
}

/**
 * Resolves targets for `manifest`. Without `targets` the instance keeps
 * `current`'s targets (update) or targets every fixture offering the
 * signature (add).
 */
export function resolveTargets(
  read: CoreReadApi,
  manifest: ContentPluginManifest,
  targets: z.infer<typeof TargetsSchema> | undefined,
  current?: ModifierInstance,
): ResolvedTargets {
  const explicit = !!targets && (targets.fixtureIds !== undefined || targets.groupIds !== undefined);
  const ids = explicit ? explicitIds(read, targets!) : current?.targetFixtureIds ?? null;
  const pool = ids ? targetFixtures(read, ids) : read.fixtures();

  if (targets?.signature && !manifest.signatures.includes(targets.signature)) {
    throw new Error(`plugin "${manifest.name}" supports signatures ${manifest.signatures.join(', ')}, not ${targets.signature}`);
  }
  const signature: Signature = targets?.signature
    ?? current?.signature
    ?? manifest.signatures.find(s => pool.some(f => f.signatures.includes(s)))
    ?? manifest.signatures[0]!;

  const keepChannels = current && !targets?.channelTypes && signature === current.signature && current.targetChannels.length > 0;
  const targetChannels = (targets?.channelTypes as ChannelType[] | undefined)
    ?? (keepChannels ? [...current!.targetChannels] : defaultChannels(signature, pool));

  const resolvedIds = ids ? [...ids] : pool.filter(f => offers(f, signature, targetChannels)).map(f => f.id);
  return { ids: resolvedIds, signature, targetChannels, fixtures: targetFixtures(read, resolvedIds) };
}

/** Selection shape of the target fixtures (default handles and recipes). */
export function targetShape(fixtures: readonly FixtureInfo[]): SelectionShape {
  return analyzeSelection(fixtures.map(f => ({ x: f.x, y: f.y, heads: f.heads })));
}

/** The targets show a saturated programmed color (recipe rule `hasColor`). */
function targetsHaveColor(ids: readonly (string | number)[]): boolean {
  const wanted = new Set(ids.map(String));
  return (useEngineStore().flatFixtures as Fixture[]).some(f => wanted.has(String(f.id)) && hasSaturatedColor(f));
}

// ── Recipes ─────────────────────────────────────

/** Finds a recipe by id or label (case-insensitive); throws with the available ones. */
export function findRecipe(manifest: ContentPluginManifest, recipe: string): ManifestPreset {
  const presets = cardPresets(manifest);
  const lower = recipe.toLowerCase();
  const found = presets.find(p => p.id === recipe) ?? presets.find(p => p.label.toLowerCase() === lower || p.id.toLowerCase() === lower);
  if (!found) throw new Error(`plugin "${manifest.name}" has no recipe "${recipe}" (recipes: ${presets.map(p => p.id).join(', ')})`);
  return found;
}

// ── Build / patch ───────────────────────────────

/** Applies the shared fields (params, spread, strength, blend, speed) to a copy. */
function applyFields(m: ModifierInstance, manifest: ContentPluginManifest, input: InstanceFields, shape: SelectionShape): ModifierInstance {
  const next = cloneModifier(m);
  if (input.params) {
    const params = { ...next.params, ...(input.params as ModifierInstance['params']) };
    // Picking an enum option that needs another spread patches it (card behavior).
    const d = input.spread ? null : distributionForParams(manifest, next.params, params, next.distribution, shape);
    next.params = params;
    if (d) next.distribution = d;
  }
  if (input.spread) next.distribution = spreadToDistribution(next.distribution, input.spread, shape);
  if (input.strength !== undefined) next.strength = input.strength;
  if (input.blend) next.blendMode = input.blend as BlendMode;
  if (input.speed) next.speed = applySpeed(next.speed, input.speed);
  return next;
}

/**
 * A new instance like the card's "Add": host defaults (absolute outputs
 * override), the recipe (named, or picked for the targets' shape) placed on
 * the targets, then the explicit fields.
 */
export function buildInstance(
  read: CoreReadApi,
  plugin: { hash: string; manifest: ContentPluginManifest },
  input: InstanceFields & { recipe?: string },
): ModifierInstance {
  const { hash, manifest } = plugin;
  const targets = resolveTargets(read, manifest, input.targets);
  const shape = targetShape(targets.fixtures);
  // Spread along the targets' main axis only when the plugin offers linear;
  // otherwise keep the manifest's default distribution (e.g. modes ["none"]).
  const modes = manifest.distribution?.modes;
  const linear = !modes || modes.includes('linear');
  const base = createModifier(hash, {
    signature: targets.signature,
    targetChannels: targets.targetChannels,
    targetFixtureIds: targets.ids,
    strength: 1,
    speed: { mode: 'beat', timeMs: 2000, beatValue: 1, beatOffset: 0 },
    blendMode: manifest.output === 'absolute' ? 'override' : 'add',
    ...(linear ? { distribution: { mode: 'linear', origin: { ...shape.axis.a }, end: { ...shape.axis.b } } } : {}),
  });
  const preset = input.recipe
    ? findRecipe(manifest, input.recipe)
    : pickPreset(manifest, { shape, hasColor: targetsHaveColor(targets.ids) });
  let inst = base;
  if (preset) {
    inst = applyPreset(base, manifest, preset);
    inst.distribution = selectionDistribution(inst.distribution, shape);
  }
  return applyFields(inst, manifest, input, shape);
}

/** `current` with the fields of `modifiers.update` applied (new object). */
export function patchInstance(read: CoreReadApi, current: ModifierInstance, input: InstanceFields): ModifierInstance {
  const manifest = getManifest(current.plugin);
  if (!manifest) throw new Error(`plugin ${current.plugin} of modifier "${current.id}" is not loaded`);
  const targets = resolveTargets(read, manifest, input.targets, current);
  const next = cloneModifier(current);
  if (input.targets) {
    next.targetFixtureIds = targets.ids;
    next.signature = targets.signature;
    next.targetChannels = targets.targetChannels;
  }
  return applyFields(next, manifest, input, targetShape(targets.fixtures));
}

/** `m` with a recipe applied like the card's preset bar (placed on the targets when the spread changes). */
export function withRecipe(read: CoreReadApi, m: ModifierInstance, recipe: string): { instance: ModifierInstance; recipeId: string } {
  const manifest = getManifest(m.plugin);
  if (!manifest) throw new Error(`plugin ${m.plugin} of modifier "${m.id}" is not loaded`);
  const preset = findRecipe(manifest, recipe);
  const instance = applyPresetOnSelection(cloneModifier(m), manifest, preset, targetShape(targetFixtures(read, m.targetFixtureIds)));
  return { instance, recipeId: preset.id };
}

// ── Checks ──────────────────────────────────────

/**
 * Postconditions of a stored instance: plugin known, signature supported,
 * ≥ 1 existing target offering the signature, target channels for scalar,
 * params valid per manifest, spread offered by the plugin.
 */
export function instanceFindings(read: CoreReadApi, m: ModifierInstance): Finding[] {
  const entity = [`modifier:${m.id}`];
  const err = (code: string, message: string): Finding => ({ level: 'error', code, message, entityIds: entity });
  const manifest = getManifest(m.plugin);
  if (!manifest) return [err('plugin-not-found', `plugin ${m.plugin} is not available`)];
  const out: Finding[] = [];
  if (!manifest.signatures.includes(m.signature)) {
    out.push(err('signature-not-supported', `"${manifest.name}" supports ${manifest.signatures.join(', ')}, not ${m.signature}`));
  }
  if (m.signature === 'scalar' && m.targetChannels.length === 0) {
    out.push(err('no-target-channels', 'scalar modifiers need channel types; pass targets.channelTypes (e.g. ["DIMMER"])'));
  }
  const fixtures = targetFixtures(read, m.targetFixtureIds);
  const missing = (m.targetFixtureIds ?? []).filter(id => !fixtures.some(f => String(f.id) === String(id)));
  if (missing.length) out.push(err('unknown-fixture', `target fixtures not found: ${missing.map(String).join(', ')}`));
  const matching = fixtures.filter(f => offers(f, m.signature, m.targetChannels));
  if (matching.length === 0) {
    out.push(err('no-targets', `no target fixture offers ${m.signature}${m.signature === 'scalar' ? ` with channels ${m.targetChannels.join(', ')}` : ''}; check targets (fixtures.find with signature/channelType)`));
  }
  else if (matching.length < fixtures.length) {
    const skipped = fixtures.filter(f => !matching.includes(f)).map(f => String(f.id));
    out.push({ level: 'warning', code: 'targets-partly-unsupported', message: `fixtures ${skipped.join(', ')} do not offer ${m.signature} and stay unaffected`, entityIds: entity });
  }
  const strayRanks = Object.keys(m.distribution.order.ranks).filter(id => !fixtures.some(f => String(f.id) === id));
  if (strayRanks.length) {
    out.push({ level: 'warning', code: 'ranks-not-targeted', message: `ranks name fixtures that are not targets and are ignored: ${strayRanks.join(', ')}`, entityIds: entity });
  }
  for (const problem of paramProblems(manifest.params, m.params)) out.push(err('invalid-param', problem));
  const modes = manifest.distribution?.modes;
  if (modes && m.distribution.scope === 'across' && !modes.includes(m.distribution.mode)) {
    out.push(err('spread-not-offered', `"${manifest.name}" offers spread modes ${modes.join(', ')}, not ${m.distribution.mode}`));
  }
  const scopes = manifest.distribution?.scopes;
  if (scopes && !scopes.includes(m.distribution.scope)) {
    out.push(err('spread-not-offered', `"${manifest.name}" offers scopes ${scopes.join(', ')}, not ${m.distribution.scope}`));
  }
  return out;
}

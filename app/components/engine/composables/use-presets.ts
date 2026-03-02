import { ref } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type {
  Preset,
  PresetCategory,
  PresetCategoryType,
  PresetChannelSnapshot,
  PresetModifierSnapshot,
} from '~/utils/engine/preset-types';
import type { ChannelType, Effect } from '~/utils/engine/types';
import type { Channel } from '~/utils/engine/core/channel';
import { SineEffect } from '~/utils/engine/effects/sine-effect';

// ─── Category helpers ─────────────────────────────────────────────────────────

const COLOR_CHANNEL_TYPES = new Set<ChannelType>([
  'RED', 'GREEN', 'BLUE', 'WHITE', 'WARM_WHITE', 'COOL_WHITE',
  'AMBER', 'UV', 'CYAN', 'MAGENTA', 'YELLOW', 'LIME', 'INDIGO',
  'COLOR_WHEEL', 'COLOR_PRESET', 'COLOR_TEMPERATURE',
]);

const MOVEMENT_CHANNEL_TYPES = new Set<ChannelType>([
  'PAN', 'TILT', 'PANTILT_SPEED',
]);

const DIMMER_CHANNEL_TYPES = new Set<ChannelType>([
  'DIMMER',
]);

const BEAM_CHANNEL_TYPES = new Set<ChannelType>([
  'STROBE', 'STROBE_SPEED', 'STROBE_DURATION',
  'ZOOM', 'FOCUS', 'IRIS', 'FROST', 'BEAM_ANGLE', 'BEAM_POSITION',
  'GOBO_WHEEL', 'GOBO_SPIN', 'PRISM', 'PRISM_ROTATION', 'BLADE',
]);

function getCategoryType(channelType: ChannelType): PresetCategoryType {
  if (COLOR_CHANNEL_TYPES.has(channelType)) return 'color';
  if (MOVEMENT_CHANNEL_TYPES.has(channelType)) return 'movement';
  if (DIMMER_CHANNEL_TYPES.has(channelType)) return 'dimmer';
  if (BEAM_CHANNEL_TYPES.has(channelType)) return 'beam';
  return 'other';
}

/** Returns true if a channel has been actively programmed from its default. */
function isChannelProgrammed(ch: Channel): boolean {
  if (ch.chaserConfig) return true;
  return ch.stepValues.some((v) => v !== ch.defaultValue);
}

/** Returns the channel-type category for an effect based on its targetChannels. */
function getEffectCategoryType(effect: Effect): PresetCategoryType {
  if (!effect.targetChannels || effect.targetChannels.length === 0) return 'other';
  // Use the first target channel as the representative category
  const firstChannel = effect.targetChannels[0];
  return firstChannel !== undefined ? getCategoryType(firstChannel) : 'other';
}

/**
 * Builds a deterministic fingerprint for channel snapshots.
 * Fixtures sharing the same fingerprint under the same category type are grouped.
 */
function getChannelFingerprint(snapshots: PresetChannelSnapshot[]): string {
  return snapshots
    .map((s) => `${s.channelType}:${s.stepValues.join(',')}`)
    .sort()
    .join('|');
}

/** Builds a deterministic fingerprint for a modifier effect. */
function getModifierFingerprint(effect: Effect): string {
  const channels = [...(effect.targetChannels ?? [])].sort().join(',');
  return `${effect.constructor.name}|${channels}|${effect.strength}|${effect.fanning}|${effect.direction}|${effect.reverse}`;
}

/** Snapshots a live Effect into a serializable PresetModifierSnapshot. */
function snapshotEffect(effect: Effect): PresetModifierSnapshot {
  return {
    effectType: effect.constructor.name,
    targetChannels: [...(effect.targetChannels ?? [])],
    targetFixtureIds: [...(effect.targetFixtureIds ?? [])],
    strength: effect.strength,
    fanning: effect.fanning,
    speed: { ...effect.speed },
    direction: effect.direction ?? 'LINEAR',
    reverse: effect.reverse ?? false,
    originX: effect.originX ?? 0.5,
    originY: effect.originY ?? 0.5,
    angle: effect.angle ?? 0,
  };
}

// ─── Grouping logic ───────────────────────────────────────────────────────────

/**
 * Extracts programmed channel state AND active modifiers from the given
 * fixtures/effects and groups them into PresetCategory entries.
 *
 * Grouping rules:
 * - Fixtures that share the same (categoryType + channel values) fingerprint
 *   are merged into one PresetCategory.
 * - Modifiers are grouped by (categoryType + modifier fingerprint) and merged
 *   the same way, so fixtures sharing the same effect appear in one group.
 */
export function extractCategories(fixtures: Fixture[], effects: Effect[] = []): PresetCategory[] {
  // key: `${categoryType}__${fingerprint}` → accumulated category
  const groupMap = new Map<string, {
    type: PresetCategoryType;
    fixtureIds: (string | number)[];
    fixtureNames: string[];
    channels: PresetChannelSnapshot[];
    modifiers: PresetModifierSnapshot[];
  }>();

  const fixtureMap = new Map<string | number, string>(fixtures.map((f) => [f.id, f.name]));

  // ── Channel-based groups ─────────────────────────────────────────────────────
  for (const fixture of fixtures) {
    const byCat = new Map<PresetCategoryType, PresetChannelSnapshot[]>();

    for (const ch of fixture.channels) {
      if (!isChannelProgrammed(ch)) continue;
      const cat = getCategoryType(ch.type);
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push({
        channelType: ch.type,
        stepValues: [...ch.stepValues],
        chaserConfig: ch.chaserConfig ? { ...ch.chaserConfig } : undefined,
      });
    }

    for (const [cat, snapshots] of byCat) {
      const fingerprint = getChannelFingerprint(snapshots);
      const key = `channel__${cat}__${fingerprint}`;

      if (groupMap.has(key)) {
        const entry = groupMap.get(key)!;
        entry.fixtureIds.push(fixture.id);
        entry.fixtureNames.push(fixture.name);
      } else {
        groupMap.set(key, {
          type: cat,
          fixtureIds: [fixture.id],
          fixtureNames: [fixture.name],
          channels: snapshots,
          modifiers: [],
        });
      }
    }
  }

  // ── Modifier/effect-based groups ─────────────────────────────────────────────
  for (const effect of effects) {
    if (!effect.targetFixtureIds || effect.targetFixtureIds.length === 0) continue;

    const cat = getEffectCategoryType(effect);
    const fingerprint = getModifierFingerprint(effect);
    const key = `modifier__${cat}__${fingerprint}`;

    // Collect only fixture IDs that are in our fixture list
    const relevantIds = effect.targetFixtureIds.filter((id) => fixtureMap.has(id));
    if (relevantIds.length === 0) continue;

    const relevantNames = relevantIds.map((id) => fixtureMap.get(id) ?? String(id));

    if (groupMap.has(key)) {
      const entry = groupMap.get(key)!;
      for (const id of relevantIds) {
        if (!entry.fixtureIds.includes(id)) {
          entry.fixtureIds.push(id);
          entry.fixtureNames.push(fixtureMap.get(id) ?? String(id));
        }
      }
      // Merge modifier snapshot (replace if already present for same type)
      const snap = snapshotEffect(effect);
      snap.targetFixtureIds = relevantIds;
      entry.modifiers.push(snap);
    } else {
      const snap = snapshotEffect(effect);
      snap.targetFixtureIds = relevantIds;
      groupMap.set(key, {
        type: cat,
        fixtureIds: relevantIds,
        fixtureNames: relevantNames,
        channels: [],
        modifiers: [snap],
      });
    }
  }

  // Build label from fixture names
  return Array.from(groupMap.values()).map(({ type, fixtureIds, fixtureNames, channels, modifiers }) => ({
    type,
    label: fixtureNames.length === 1
      ? (fixtureNames[0] ?? 'Fixture')
      : `${fixtureNames[0] ?? 'Fixture'} + ${fixtureNames.length - 1} more`,
    fixtureIds,
    channels,
    modifiers,
  }));
}

// ─── Preset application ───────────────────────────────────────────────────────

/** Resets all channels on the given fixtures back to their default values. */
function resetFixtureChannels(fixtures: Fixture[]): void {
  for (const fixture of fixtures) {
    for (const ch of fixture.channels) {
      ch.stepValues = [ch.defaultValue];
      ch.currentBaseValue = ch.defaultValue;
      ch.chaserConfig = undefined;
    }
  }
}

/** Reconstructs an Effect instance from a PresetModifierSnapshot. */
function reconstructEffect(snap: PresetModifierSnapshot): Effect | null {
  if (snap.effectType === 'SineEffect') {
    const eff = new SineEffect();
    eff.targetChannels = [...snap.targetChannels];
    eff.targetFixtureIds = [...snap.targetFixtureIds];
    eff.strength = snap.strength;
    eff.fanning = snap.fanning;
    eff.speed = { ...snap.speed };
    eff.direction = snap.direction ?? 'LINEAR';
    eff.reverse = snap.reverse ?? false;
    eff.originX = snap.originX ?? 0.5;
    eff.originY = snap.originY ?? 0.5;
    eff.angle = snap.angle ?? 0;
    return eff;
  }
  // Future effect types can be added here
  return null;
}

/**
 * Applies a preset's channel snapshots back to live fixtures and restores
 * modifier effects into the engine's effects array.
 */
function applyPresetToFixtures(preset: Preset, fixtures: Fixture[], effects: Effect[]): void {
  const fixtureMap = new Map<string | number, Fixture>(fixtures.map((f) => [f.id, f]));

  // Remove all effects that were targeting any fixture in the preset
  const allPresetFixtureIds = new Set(preset.categories.flatMap((c) => c.fixtureIds));
  for (let i = effects.length - 1; i >= 0; i--) {
    const eff = effects[i];
    if (eff?.targetFixtureIds?.some((id) => allPresetFixtureIds.has(id))) {
      effects.splice(i, 1);
    }
  }

  // Apply channel snapshots
  for (const category of preset.categories) {
    for (const fixtureId of category.fixtureIds) {
      const fixture = fixtureMap.get(fixtureId);
      if (!fixture) continue;

      for (const snap of category.channels) {
        const ch = fixture.channels.find((c) => c.type === snap.channelType);
        if (!ch) continue;

        ch.stepValues = [...snap.stepValues];
        ch.currentBaseValue = snap.stepValues[0] ?? ch.defaultValue;
        ch.chaserConfig = snap.chaserConfig ? { ...snap.chaserConfig } : undefined;
      }
    }

    // Restore modifier effects
    for (const modSnap of category.modifiers) {
      const eff = reconstructEffect(modSnap);
      if (eff) effects.push(eff);
    }
  }
}

// ─── Singleton state ──────────────────────────────────────────────────────────

let nextPresetIndex = 1;
const savedPresets = ref<Preset[]>([]);
const selectedPresetId = ref<string | null>(null);

/**
 * Global preset state composable (singleton).
 *
 * All methods receive the live `effects` array from `EffectEngine.effects`
 * so that modifiers are included in preset saves, unsaved-change detection,
 * and preset application.
 */
export function usePresets() {
  function getUnsavedChanges(fixtures: Fixture[], effects: Effect[] = []): PresetCategory[] {
    return extractCategories(fixtures, effects);
  }

  function savePreset(name: string, fixtures: Fixture[], effects: Effect[]): Preset {
    const id = `preset-${Date.now()}-${nextPresetIndex++}`;
    const preset: Preset = {
      id,
      name,
      createdAt: new Date().toISOString(),
      categories: extractCategories(fixtures, effects),
    };
    savedPresets.value.push(preset);
    selectedPresetId.value = id;

    // Clear the programmer — channel values + modifiers
    resetFixtureChannels(fixtures);
    for (let i = effects.length - 1; i >= 0; i--) {
      const eff = effects[i];
      if (eff?.targetFixtureIds?.some((id) => fixtures.some((f) => f.id === id))) {
        effects.splice(i, 1);
      }
    }

    return preset;
  }

  function applyPreset(preset: Preset, fixtures: Fixture[], effects: Effect[]): void {
    applyPresetToFixtures(preset, fixtures, effects);
    selectedPresetId.value = preset.id;
  }

  function stopPreset(preset: Preset, fixtures: Fixture[], effects: Effect[]): void {
    const fixtureMap = new Map<string | number, Fixture>(fixtures.map((f) => [f.id, f]));

    // Remove all effects that were targeting any fixture in the preset
    const allPresetFixtureIds = new Set(preset.categories.flatMap((c) => c.fixtureIds));
    for (let i = effects.length - 1; i >= 0; i--) {
      const eff = effects[i];
      if (eff?.targetFixtureIds?.some((id) => allPresetFixtureIds.has(id))) {
        effects.splice(i, 1);
      }
    }

    // Apply channel snapshots
    for (const category of preset.categories) {
      for (const fixtureId of category.fixtureIds) {
        const fixture = fixtureMap.get(fixtureId);
        if (!fixture) continue;

        for (const snap of category.channels) {
          const ch = fixture.channels.find((c) => c.type === snap.channelType);
          if (!ch) continue;

          ch.stepValues = [ch.defaultValue];
          ch.currentBaseValue = ch.defaultValue;
          ch.chaserConfig = undefined;
        }
      }
    }

    if (selectedPresetId.value === preset.id) {
      selectedPresetId.value = null;
    }
  }

  function deletePreset(id: string): void {
    const idx = savedPresets.value.findIndex((p) => p.id === id);
    if (idx !== -1) savedPresets.value.splice(idx, 1);
    if (selectedPresetId.value === id) selectedPresetId.value = null;
  }

  function renamePreset(id: string, newName: string): void {
    const preset = savedPresets.value.find((p) => p.id === id);
    if (preset) preset.name = newName;
  }

  return {
    savedPresets,
    selectedPresetId,
    getUnsavedChanges,
    savePreset,
    applyPreset,
    stopPreset,
    deletePreset,
    renamePreset,
  };
}

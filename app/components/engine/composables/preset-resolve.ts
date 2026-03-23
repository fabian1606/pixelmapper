import type { Preset, PresetCategory, PresetChannelSnapshot, PresetModifierSnapshot } from '~/utils/engine/preset-types';
import { getCategoryType, getChannelFingerprint, getModifierIdentity } from './preset-helpers';

interface SnapshotMaps {
  channels: Map<string, { fId: string | number; snap: PresetChannelSnapshot }>;
  modifiers: Map<string, { fId: string | number; snap: PresetModifierSnapshot }>;
}

function flattenPreset(preset: Preset, maps: SnapshotMaps) {
  for (const cat of preset.categories) {
    for (const fId of cat.fixtureIds) {
      for (const ch of cat.channels) {
        maps.channels.set(`${fId}:${ch.channelIndex}`, { fId, snap: ch });
      }
      for (const mod of cat.modifiers) {
        maps.modifiers.set(`${fId}:${getModifierIdentity(mod)}`, { fId, snap: mod });
      }
    }
  }
}

/**
 * Recursively resolves a preset by merging it on top of its base preset.
 * The resulting preset contains the combined state of all its parents.
 */
export function resolvePreset(preset: Preset, allPresets: Preset[]): Preset {
  if (!preset.basePresetId) return preset;

  const base = allPresets.find((p) => p.id === preset.basePresetId);
  if (!base) return preset;

  const resolvedBase = resolvePreset(base, allPresets);

  const maps: SnapshotMaps = { channels: new Map(), modifiers: new Map() };
  flattenPreset(resolvedBase, maps);
  flattenPreset(preset, maps);

  // Group the merged snapshots back into categories
  const categoriesMap = new Map<string, Omit<PresetCategory, 'label'>>();

  // Process channels
  const fIdToChannels = new Map<string | number, PresetChannelSnapshot[]>();
  for (const { fId, snap } of maps.channels.values()) {
    if (!fIdToChannels.has(fId)) fIdToChannels.set(fId, []);
    fIdToChannels.get(fId)!.push(snap);
  }

  for (const [fId, channels] of fIdToChannels.entries()) {
    // Group channels by category for this fixture
    const catMap = new Map<string, PresetChannelSnapshot[]>();
    for (const ch of channels) {
      const type = getCategoryType(ch.channelType);
      if (!catMap.has(type)) catMap.set(type, []);
      catMap.get(type)!.push(ch);
    }

    // Fingerprint each category segment and group
    for (const [type, snaps] of catMap.entries()) {
      snaps.sort((a, b) => a.channelIndex - b.channelIndex); // Ensure stable order
      const fingerprint = getChannelFingerprint(snaps);
      const key = `channel__${type}__${fingerprint}`;
      
      if (!categoriesMap.has(key)) {
        categoriesMap.set(key, { type: type as any, fixtureIds: [], channels: snaps, modifiers: [], isModifier: false });
      }
      categoriesMap.get(key)!.fixtureIds.push(fId);
    }
  }

  // Process modifiers
  const fIdToModifiers = new Map<string | number, PresetModifierSnapshot[]>();
  for (const { fId, snap } of maps.modifiers.values()) {
    if (!fIdToModifiers.has(fId)) fIdToModifiers.set(fId, []);
    fIdToModifiers.get(fId)!.push(snap);
  }

  for (const [fId, modifiers] of fIdToModifiers.entries()) {
    for (const mod of modifiers) {
      const type = getCategoryType(mod.targetChannels[0] ?? 'PAN');
      const identity = getModifierIdentity(mod);
      const key = `modifier__${type}__${identity}`;

      if (!categoriesMap.has(key)) {
        // Strip targetFixtureIds from the snapshot and leave it up to the category grouping
        categoriesMap.set(key, { type, fixtureIds: [], channels: [], modifiers: [{ ...mod, targetFixtureIds: [] }], isModifier: true });
      } else {
        // Just ensure the modifier is kept updated (since we keyed by identity, we just take the first)
        categoriesMap.get(key)!.modifiers[0] = { ...mod, targetFixtureIds: [] };
      }
      
      const entry = categoriesMap.get(key)!;
      if (!entry.fixtureIds.includes(fId)) {
        entry.fixtureIds.push(fId);
      }
    }
  }

  // Map to the final array, providing a dummy label (used internally only)
  const categories: PresetCategory[] = Array.from(categoriesMap.values()).map(c => ({
    ...c,
    label: `Merged (${c.type})`
  }));

  return {
    ...preset,
    categories,
    // The resolved preset acts as a standalone preset, so wipe basePresetId to avoid recursive confusion if used incorrectly
    basePresetId: undefined, 
  };
}

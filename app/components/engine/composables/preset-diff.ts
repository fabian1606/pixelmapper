import type { Fixture } from '~/utils/engine/core/fixture';
import type { Effect } from '~/utils/engine/types';
import type {
  Preset,
  PresetCategory,
  PresetCategoryType,
  PresetChannelSnapshot,
  PresetModifierSnapshot,
} from '~/utils/engine/preset-types';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import {
  getCategoryType,
  getEffectCategoryType,
  getChannelFingerprint,
  getModifierFingerprint,
  getModifierIdentity,
  isChannelProgrammed,
  snapshotEffect,
} from './preset-helpers';

// ─── Internal types ───────────────────────────────────────────────────────────

interface GroupEntry {
  type: PresetCategoryType;
  fixtureIds: (string | number)[];
  fixtureNames: string[];
  channels: PresetChannelSnapshot[];
  modifiers: PresetModifierSnapshot[];
  /** Tracks the current identity-keyed modifier for later replacement */
  modifierIdentity?: string;
}

// ─── Group label resolution ───────────────────────────────────────────────────

function resolveGroupLabel(
  fixtureIds: (string | number)[],
  fixtureNames: string[],
  nodes?: SceneNode[]
): string {
  if (nodes) {
    const groups: FixtureGroup[] = [];
    const traverse = (nodeList: SceneNode[]) => {
      for (const node of nodeList) {
        if (node instanceof FixtureGroup) {
          groups.push(node);
          traverse(node.children);
        }
      }
    };
    traverse(nodes);

    const matchingGroup = groups.find((g) => {
      const groupFixtures = g.getAllFixtures();
      return (
        groupFixtures.length > 0 &&
        groupFixtures.length === fixtureIds.length &&
        groupFixtures.every((gf) => fixtureIds.includes(gf.id as string | number))
      );
    });

    if (matchingGroup) return `${matchingGroup.name} (Group)`;

    for (const g of groups) {
      const groupFixtures = g.getAllFixtures();
      if (groupFixtures.length === 0) continue;
      const allInGroup = groupFixtures.every((gf) => fixtureIds.includes(gf.id as string | number));
      if (allInGroup && fixtureIds.length > groupFixtures.length) {
        const extra = fixtureIds.length - groupFixtures.length;
        return `${g.name} (Group) + ${extra} more`;
      }
    }
  }

  return fixtureNames.length === 1
    ? (fixtureNames[0] ?? 'Fixture')
    : `${fixtureNames[0] ?? 'Fixture'} + ${fixtureNames.length - 1} more`;
}

// ─── Preset flattening ────────────────────────────────────────────────────────

function buildPresetIndex(activePreset: Preset): {
  channels: Map<string, PresetChannelSnapshot>;
  modifiers: Map<string, PresetModifierSnapshot>;
} {
  // key: `${fixtureId}:${channelIndex}` → snapshot
  const channels = new Map<string, PresetChannelSnapshot>();
  const modifiers = new Map<string, PresetModifierSnapshot>();

  for (const cat of activePreset.categories) {
    for (const fixId of cat.fixtureIds) {
      for (const ch of cat.channels) {
        channels.set(`${fixId}:${ch.channelIndex}`, ch);
      }
      for (const mod of cat.modifiers) {
        const identity = getModifierIdentity(mod);
        modifiers.set(`${fixId}:${identity}`, mod);
      }
    }
  }

  return { channels, modifiers };
}

// ─── Channel diffing ──────────────────────────────────────────────────────────

function diffChannels(
  fixtures: Fixture[],
  fixtureMap: Map<string | number, string>,
  presetChannels: Map<string, PresetChannelSnapshot>,
  activePreset: Preset | null,
  groupMap: Map<string, GroupEntry>
): void {
  for (const fixture of fixtures) {
    const changesByCat = new Map<PresetCategoryType, PresetChannelSnapshot[]>();

    for (let i = 0; i < fixture.channels.length; i++) {
      const ch = fixture.channels[i]!;
      const cat = getCategoryType(ch.type);
      const isProgrammed = isChannelProgrammed(ch);
      // Key by channelIndex to distinguish e.g. 8 RED channels on an LED bar.
      const presetKey = `${fixture.id}:${i}`;
      const presetSnap = presetChannels.get(presetKey);

      if (isProgrammed) {
        const snap: PresetChannelSnapshot = {
          channelIndex: i,
          channelType: ch.type,
          stepValues: [...ch.chaserConfig.stepValues],
          chaserConfig: { ...ch.chaserConfig },
        };

        if (activePreset) {
          let differs = !presetSnap;
          if (presetSnap) {
            if (snap.stepValues.join(',') !== presetSnap.stepValues.join(',')) differs = true;
            if (JSON.stringify(snap.chaserConfig) !== JSON.stringify(presetSnap.chaserConfig)) differs = true;
          }
          if (differs) {
            if (!changesByCat.has(cat)) changesByCat.set(cat, []);
            changesByCat.get(cat)!.push(snap);
          }
        } else {
          if (!changesByCat.has(cat)) changesByCat.set(cat, []);
          changesByCat.get(cat)!.push(snap);
        }
      } else if (activePreset && presetSnap) {
        // Channel reverted to default while preset had a value → show as change
        if (!changesByCat.has(cat)) changesByCat.set(cat, []);
        changesByCat.get(cat)!.push({
          channelIndex: i,
          channelType: ch.type,
          stepValues: [ch.defaultValue],
          chaserConfig: undefined,
        });
      }
    }

    for (const [cat, snapshots] of changesByCat) {
      const fingerprint = getChannelFingerprint(snapshots);
      const key = `channel__${cat}__${fingerprint}`;

      if (groupMap.has(key)) {
        const entry = groupMap.get(key)!;
        if (!entry.fixtureIds.includes(fixture.id)) {
          entry.fixtureIds.push(fixture.id);
          entry.fixtureNames.push(fixture.name);
        }
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
}

// ─── Modifier diffing ─────────────────────────────────────────────────────────

/**
 * Adds or updates a modifier-change row in the groupMap.
 * Keyed by *identity* (type + channels) so parameter tweaks update the
 * existing row rather than creating a second one.
 */
function upsertModifierChange(
  groupMap: Map<string, GroupEntry>,
  fixtureMap: Map<string | number, string>,
  fixtureId: string | number,
  cat: PresetCategoryType,
  snap: PresetModifierSnapshot
): void {
  const identity = getModifierIdentity(snap);
  const key = `modifier__${cat}__${identity}`;

  if (groupMap.has(key)) {
    const entry = groupMap.get(key)!;
    // Update the modifier snapshot in-place (replace with latest values)
    entry.modifiers[0] = { ...snap, targetFixtureIds: [] };
    if (!entry.fixtureIds.includes(fixtureId)) {
      entry.fixtureIds.push(fixtureId);
      entry.fixtureNames.push(fixtureMap.get(fixtureId) ?? String(fixtureId));
    }
  } else {
    groupMap.set(key, {
      type: cat,
      fixtureIds: [fixtureId],
      fixtureNames: [fixtureMap.get(fixtureId) ?? String(fixtureId)],
      channels: [],
      modifiers: [{ ...snap, targetFixtureIds: [] }],
    });
  }
}

function diffModifiers(
  effects: Effect[],
  fixtureMap: Map<string | number, string>,
  presetModifiers: Map<string, PresetModifierSnapshot>,
  activePreset: Preset | null,
  groupMap: Map<string, GroupEntry>
): void {
  const seenKeys = new Set<string>(); // `${fixtureId}:${identity}`

  for (const effect of effects) {
    if (!effect.targetFixtureIds?.length) continue;

    const cat = getEffectCategoryType(effect);
    const fp = getModifierFingerprint(effect);
    const identity = getModifierIdentity(effect);
    const relevantIds = effect.targetFixtureIds.filter((id) => fixtureMap.has(id));
    if (relevantIds.length === 0) continue;

    const snap = snapshotEffect(effect);

    for (const fId of relevantIds) {
      const pKey = `${fId}:${identity}`;
      seenKeys.add(pKey);

      if (activePreset) {
        const presetSnap = presetModifiers.get(pKey);
        if (!presetSnap) {
          // Newly added effect not in preset
          upsertModifierChange(groupMap, fixtureMap, fId, cat, snap);
        } else if (getModifierFingerprint(presetSnap) !== fp) {
          // Same effect, but parameters changed
          upsertModifierChange(groupMap, fixtureMap, fId, cat, snap);
        }
        // If fingerprints match, no change — don't add to groupMap
      } else {
        upsertModifierChange(groupMap, fixtureMap, fId, cat, snap);
      }
    }
  }

  // Check for removed modifiers (in preset but no longer active)
  if (activePreset) {
    for (const [pKey, modSnap] of presetModifiers.entries()) {
      if (!seenKeys.has(pKey)) {
        // pKey format: `${fixtureId}:${identity}` — split on first colon only
        const colonIdx = pKey.indexOf(':');
        const rawId = pKey.slice(0, colonIdx);
        const fId = isNaN(Number(rawId)) ? rawId : Number(rawId);
        const cat = getCategoryType(modSnap.targetChannels[0] ?? 'PAN');
        upsertModifierChange(groupMap, fixtureMap, fId, cat, { ...modSnap, strength: 0 });
      }
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extracts programmed channel state AND active modifiers from the given
 * fixtures / effects and groups them into PresetCategory entries.
 *
 * When `activePreset` is provided the result only contains rows that *differ*
 * from the preset, making it suitable for the "unsaved changes" UI.
 */
export function extractCategories(
  fixtures: Fixture[],
  effects: Effect[] = [],
  activePreset: Preset | null = null,
  nodes?: SceneNode[]
): PresetCategory[] {
  const groupMap = new Map<string, GroupEntry>();
  const fixtureMap = new Map<string | number, string>(fixtures.map((f) => [f.id, f.name]));

  const { channels: presetChannels, modifiers: presetModifiers } = activePreset
    ? buildPresetIndex(activePreset)
    : { channels: new Map(), modifiers: new Map() };

  diffChannels(fixtures, fixtureMap, presetChannels, activePreset, groupMap);
  diffModifiers(effects, fixtureMap, presetModifiers, activePreset, groupMap);

  return Array.from(groupMap.values()).map(({ type, fixtureIds, fixtureNames, channels, modifiers }) => ({
    type,
    label: resolveGroupLabel(fixtureIds, fixtureNames, nodes),
    fixtureIds,
    channels,
    modifiers,
    isModifier: channels.length === 0 && modifiers.length > 0,
  }));
}

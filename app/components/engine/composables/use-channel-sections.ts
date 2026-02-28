import { computed, type Ref } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { ChannelType } from '~/utils/engine/types';
import { TAB_ORDER, CHANNEL_CATEGORIES, type ChannelCategoryKey } from '~/utils/engine/channel-categories';

export interface ChannelEntry {
  channelType: ChannelType;
  /** The exact OFL channel name (e.g. 'Gobo Wheel 1') — used to distinguish
   *  multiple channels that share the same ChannelType on a fixture. */
  oflChannelName: string;
  fixtures: Fixture[];
}

export interface ChannelSection {
  name: string;    // section label ("Combined", "MH-X25", etc.)
  showLabel: boolean;
  entries: ChannelEntry[];
}

export function useChannelSections(
  activeTab: Ref<ChannelCategoryKey | null>,
  selectedFixturesFn: () => Fixture[]
) {
  function tabChannelFilter(type: ChannelType, role?: string): boolean {
    if (!activeTab.value) return false;
    const cat = CHANNEL_CATEGORIES.find(c => c.id === activeTab.value);
    if (!cat) return false;
    if (cat.id === 'intensity' && role === 'DIMMER') return true;
    if (cat.id === 'color' && role === 'COLOR') return true;
    return cat.types.includes(type);
  }

  const channelSections = computed((): ChannelSection[] => {
    const fixtures = selectedFixturesFn();
    if (fixtures.length === 0) return [];

    const getFixtureType = (f: Fixture): string => {
      const ext = f as Fixture & { oflShortName?: string };
      return (ext.oflShortName ?? f.name.replace(/\s+\d+$/, '')).trim();
    };

    const allFixtureTypes = new Set(fixtures.map(getFixtureType));
    const showLabels = allFixtureTypes.size > 1;

    // 1. Collect all unique channels across all selected fixtures in this tab
    type ChannelKey = string;
    const allChannels = new Map<ChannelKey, { channelType: ChannelType; oflChannelName: string; fixtures: Fixture[] }>();

    for (const f of fixtures) {
      const usedKeysInFixture = new Set<string>();

      for (const ch of f.channels) {
        if (!tabChannelFilter(ch.type, ch.role)) continue;

        const rawName = ch.oflChannelName ?? ch.type;
        const normalizedName = rawName.toLowerCase().trim();

        const caps = ch.oflCapabilities ?? [];
        let capSig = '';
        if (caps.length > 1) {
          capSig = caps.map(c => `${c.type}:${c.dmxRange ? c.dmxRange[0] + '-' + c.dmxRange[1] : ''}`).join('|');
        }

        const baseKey = `${ch.type}::${normalizedName}::${capSig}`;

        let finalKey = baseKey;
        let dedup = 1;
        while (usedKeysInFixture.has(finalKey)) {
          finalKey = `${baseKey}::dedup${dedup++}`;
        }
        usedKeysInFixture.add(finalKey);

        if (!allChannels.has(finalKey)) {
          allChannels.set(finalKey, { channelType: ch.type, oflChannelName: rawName, fixtures: [] });
        }
        allChannels.get(finalKey)!.fixtures.push(f);
      }
    }

    // Sort channels by TAB_ORDER, then alphabetically
    const tabOrderIndex = new Map(TAB_ORDER.map((t, i) => [t, i]));
    const orderedChannels = [...allChannels.values()].sort((a, b) => {
      const ai = tabOrderIndex.get(a.channelType) ?? 999;
      const bi = tabOrderIndex.get(b.channelType) ?? 999;
      if (ai !== bi) return ai - bi;
      return a.oflChannelName.localeCompare(b.oflChannelName);
    });

    // 2. Bucket channels into Combined vs. Specific Models
    const combinedEntries: ChannelEntry[] = [];
    const modelEntries = new Map<string, ChannelEntry[]>();

    for (const item of orderedChannels) {
      // A channel is "Combined" if every selected fixture type has at least one fixture with this channel
      const itemFixtureTypes = new Set(item.fixtures.map(getFixtureType));

      if (itemFixtureTypes.size === allFixtureTypes.size) {
        combinedEntries.push({
          channelType: item.channelType,
          oflChannelName: item.oflChannelName,
          fixtures: item.fixtures
        });
      } else {
        // Otherwise, add it to the section for each fixture model that has it
        for (const modelName of itemFixtureTypes) {
          if (!modelEntries.has(modelName)) modelEntries.set(modelName, []);

          // Only include the fixtures of *this* model
          const fixturesOfModel = item.fixtures.filter(f => getFixtureType(f) === modelName);

          modelEntries.get(modelName)!.push({
            channelType: item.channelType,
            oflChannelName: item.oflChannelName,
            fixtures: fixturesOfModel
          });
        }
      }
    }

    // 3. Assemble final sections
    const sections: ChannelSection[] = [];

    if (combinedEntries.length > 0) {
      sections.push({
        name: showLabels ? 'Combined' : '',
        showLabel: showLabels,
        entries: combinedEntries
      });
    }

    // Add model-specific sections (sorted alphabetically by model name)
    const sortedModels = [...modelEntries.keys()].sort((a, b) => a.localeCompare(b));
    for (const modelName of sortedModels) {
      sections.push({
        name: modelName,
        showLabel: true, // Always show labels for specific models if we reached this code
        entries: modelEntries.get(modelName)!
      });
    }

    return sections;
  });

  return { tabChannelFilter, channelSections };
}

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { onClickOutside } from '@vueuse/core';
import { ScrollArea } from '@/components/ui/scroll-area';
import { OctagonX, ListOrdered } from 'lucide-vue-next';
import {
  CHANNEL_CATEGORIES,
  TAB_ORDER,
  getAvailableCategories
} from '~/utils/engine/channel-categories';
import type { Fixture } from '~/utils/engine/core/fixture';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import type { ChannelType } from '~/utils/engine/types';
import FixturePropertyControl from './FixturePropertyControl.vue';
import { provideSidebarLock } from '~/utils/engine/composables/use-sidebar-lock';
import { syncCategoryBeforeEdit } from '~/utils/engine/composables/use-category-sync';
import { useHistory } from '~/components/engine/composables/use-history';
import { SetChannelValuesCommand, createSnapshot, type SnapshotMap } from './commands/set-channel-values-command';

interface Props {
  selectedIds: Set<string | number>;
  fixtures: Fixture[];
  nodes: SceneNode[]; // Need the full scene graph to resolve groups
}

const props = defineProps<Props>();

import type { ChannelCategoryKey } from '~/utils/engine/channel-categories';
import ChaserStepsManager from './ChaserStepsManager.vue';

// Sidebar close lock: child dropdowns increment this to prevent auto-close
const { openCount: lockedOpenCount } = provideSidebarLock();

const history = useHistory();

// Tabs logic
const activeTab = ref<ChannelCategoryKey | null>(null);
const sidebarRef = ref<HTMLElement | null>(null);

// Steps Manager reference to access the active chaser configuration
const stepsManager = ref<InstanceType<typeof ChaserStepsManager> | null>(null);

onClickOutside(
  sidebarRef,
  () => {
    // Don't close the sidebar if a child floating UI (dropdown, popover) is open
    if (lockedOpenCount.value !== undefined && lockedOpenCount.value > 0) return;
    activeTab.value = null;
  },
  { ignore: ['.viewport'] } // Don't close when clicking or dragging anywhere on the canvas
);

function toggleTab(tab: ChannelCategoryKey) {
  if (activeTab.value === tab) {
    activeTab.value = null;
  } else {
    activeTab.value = tab;
  }
}

function snapshotChannels(fixtures: Fixture[]): SnapshotMap {
  const map: SnapshotMap = new Map();
  for (const f of fixtures) {
    for (let i = 0; i < f.channels.length; i++) {
        const ch = f.channels[i];
        if (!ch) continue;
        map.set({ fixture: f, channelIndex: i }, {
            before: createSnapshot(ch),
            after: null as any
        });
    }
  }
  return map;
}

function commitSnapshots(map: SnapshotMap, description: string) {
    let changed = false;
    for (const [ref, state] of map.entries()) {
        const ch = ref.fixture.channels[ref.channelIndex];
        if (!ch) continue;
        state.after = createSnapshot(ch);
        if (
            state.before.colorValue !== state.after.colorValue ||
            JSON.stringify(state.before.stepValues) !== JSON.stringify(state.after.stepValues) ||
            JSON.stringify(state.before.chaserConfig) !== JSON.stringify(state.after.chaserConfig)
        ) {
            changed = true;
        }
    }
    if (changed) {
        history.execute(new SetChannelValuesCommand(map, description));
    }
}

function stopAllOrSelected() {
  const targetFixtures = props.selectedIds.size > 0 ? getSelectedFixtures() : props.fixtures;
  const snapshots = snapshotChannels(targetFixtures);
  
  for (const f of targetFixtures) {
    for (const ch of f.channels) {
      if (ch.stepValues.some(v => v !== 0) || ch.chaserConfig) {
        ch.stepValues = [0];
        ch.value = 0;
        ch.chaserConfig = undefined;
      }
    }
  }
  
  commitSnapshots(snapshots, 'Stop All');
}

function resetActiveTabGroup() {
  if (!activeTab.value) return;
  const fixtures = getSelectedFixtures();
  const snapshots = snapshotChannels(fixtures);
  
  for (const f of fixtures) {
    for (const ch of f.channels) {
      if (tabChannelFilter(ch.type, ch.role)) {
        ch.stepValues = [0];
        ch.value = 0;
        ch.chaserConfig = undefined;
      }
    }
  }
  
  commitSnapshots(snapshots, `Reset ${activeTab.value}`);
}

// ─── Category sync ────────────────────────────────────────────────────────────
// When the user touches a fader, sync all category channels from the richest fixture
// to any blank fixtures in the selection BEFORE the specific value is written.
function handleBeforeChange(fixtures: Fixture[]) {
  syncCategoryBeforeEdit(fixtures, (type, role) => tabChannelFilter(type, role));
}

// Helpers ------------------------------------------------------------------

function getSelectedFixtures(): Fixture[] {
  const result: Fixture[] = [];
  function traverse(nodes: SceneNode[], inherited = false) {
    for (const node of nodes) {
      const selected = inherited || props.selectedIds.has(node.id);
      if (node instanceof FixtureGroup) traverse(node.children, selected);
      else if (selected) result.push(node as Fixture);
    }
  }
  traverse(props.nodes);
  return result;
}

/** Stable fingerprint for a channel.
 *  - Single-capability channels: fingerprinted by type only, so e.g. a DIMMER
 *    called "Dimmer" and one called "Intensity" still merge into the same group.
 *  - Multi-capability channels (color wheels, strobe modes etc.): also include
 *    capability details so they stay separate from simpler same-type channels.
 */
function channelFingerprint(type: ChannelType, fixture: Fixture): string {
  const ch = fixture.channels.find(c => c.type === type);
  if (!ch) return type;
  const caps = ch.oflCapabilities ?? [];
  // Ignore sub-range details when there is only one (or no) capability
  if (caps.length <= 1) return type;
  const capSig = caps.map(c => `${c.type}:${c.dmxRange}`).join('|');
  return `${type}::${capSig}`;
}

// Computed tabs visibility -------------------------------------------------

const availableTabs = computed(() => {
  return getAvailableCategories(getSelectedFixtures());
});

// Auto-close the sidebar if the selected fixtures no longer support the active category
watch(availableTabs, (tabs) => {
  if (activeTab.value && !tabs[activeTab.value]) {
    activeTab.value = null;
  }
});

const activeTabFixtureCount = computed(() => {
  if (!activeTab.value) return 0;
  return availableTabs.value[activeTab.value] ?? 0;
});

// Calculate which categories have any modified values (programmed)
const modifiedCategories = computed<Set<ChannelCategoryKey>>(() => {
  const modified = new Set<ChannelCategoryKey>();
  const fixtures = getSelectedFixtures();
  
  for (const fixture of fixtures) {
    for (const channel of fixture.channels) {
      const isProgrammed = channel.chaserConfig || channel.stepValues.some(v => v !== 0);
      if (isProgrammed) {
        // Find which category this channel belongs to
        for (const cat of CHANNEL_CATEGORIES) {
          if (cat.id === 'intensity' && channel.role === 'DIMMER') modified.add(cat.id);
          else if (cat.id === 'color' && channel.role === 'COLOR') modified.add(cat.id);
          else if (cat.types.includes(channel.type)) modified.add(cat.id);
        }
      }
    }
  }
  return modified;
});

const stopAllTooltip = computed(() => {
  const fixtures = getSelectedFixtures();
  if (fixtures.length > 0) {
    return `Stop functions of ${fixtures.length} fixtures`;
  }
  return 'Stop all functions';
});

// Channel sections for the active tab ----------------------------------------

/** One channel row inside a section */
interface ChannelEntry {
  channelType: ChannelType;
  /** The exact OFL channel name (e.g. 'Gobo Wheel 1') — used to distinguish
   *  multiple channels that share the same ChannelType on a fixture. */
  oflChannelName: string;
  fixtures: Fixture[];
}

/** One visual section with a single label header and 1-N channel rows */
interface ChannelSection {
  name: string;    // section label ("Combined", "MH-X25", etc.)
  showLabel: boolean;
  entries: ChannelEntry[];
}

function tabChannelFilter(type: ChannelType, role?: string): boolean {
  if (!activeTab.value) return false;
  const cat = CHANNEL_CATEGORIES.find(c => c.id === activeTab.value);
  if (!cat) return false;
  if (cat.id === 'intensity' && role === 'DIMMER') return true;
  if (cat.id === 'color' && role === 'COLOR') return true;
  return cat.types.includes(type);
}

const channelSections = computed((): ChannelSection[] => {
  const fixtures = getSelectedFixtures();
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
        capSig = caps.map(c => `${c.type}:${c.dmxRange ? c.dmxRange[0]+'-'+c.dmxRange[1] : ''}`).join('|');
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
</script>

<template>
  <div ref="sidebarRef" class="absolute right-0 top-0 h-full flex pointer-events-none">
    
    <!-- Floating Overlay Panel -->
    <div 
      class="pointer-events-auto absolute right-14 top-4 bottom-4 w-72 bg-background border border-border shadow-2xl rounded-2xl z-10 overflow-hidden transition-all duration-200 ease-out"
      :class="[activeTab ? 'translate-x-0 opacity-100 scale-100' : 'translate-x-4 opacity-0 scale-95 pointer-events-none']"
    >
      <div v-if="activeTab" class="flex flex-col h-full">
        <!-- Overlay Header -->
        <div class="p-4 border-b border-border text-sm font-medium capitalize text-muted-foreground flex items-center justify-between">
          <span>{{ activeTab }}</span>
          <div class="flex items-center gap-2">
            <span v-if="activeTab && availableTabs.total > 0" class="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full whitespace-nowrap normal-case">
              {{ activeTabFixtureCount }} of {{ availableTabs.total }} Fixture{{ availableTabs.total === 1 ? '' : 's' }}
            </span>
            <button
               v-if="activeTab"
               @click="resetActiveTabGroup"
               class="p-1 rounded transition-colors"
               :class="!modifiedCategories.has(activeTab) ? 'text-muted-foreground/30 cursor-not-allowed' : 'text-muted-foreground hover:bg-muted hover:text-red-500 hover:opacity-100'"
               title="Stop this group's functions"
               :disabled="!modifiedCategories.has(activeTab)"
            >
              <OctagonX class="size-4" />
            </button>
          </div>
        </div>

        <!-- Chaser Steps Manager -->
        <ChaserStepsManager 
          v-if="activeTab"
          auto-close
          ref="stepsManager"
          :active-tab="activeTab"
          :fixtures="getSelectedFixtures()" 
        />
        
        <!-- Overlay Content (Faders) -->
        <ScrollArea v-show="!stepsManager || stepsManager.layerMode === 'steps'" class="flex-1 min-h-0 p-4">
          <div v-if="channelSections.length === 0" class="text-sm text-muted-foreground text-center mt-10">
            No adjustable properties found.
          </div>
          <div v-else class="space-y-5">
            <div v-for="(section, idx) in channelSections" :key="idx">
              <!-- Section label: only shown when multiple fixture types are selected -->
              <div v-if="section.showLabel" class="flex items-center gap-2 mb-1.5">
                <span class="text-[10px] font-mono text-muted-foreground uppercase tracking-wider flex-shrink-0">
                  {{ section.name }}
                </span>
                <div class="h-px bg-border flex-1"></div>
              </div>

              <!-- Channel rows for this section -->
              <div class="space-y-0.5">
                <FixturePropertyControl
                  v-for="entry in section.entries"
                  :key="`${entry.channelType}:${entry.oflChannelName}`"
                  :type="entry.channelType"
                  :oflChannelName="entry.oflChannelName"
                  :fixtures="entry.fixtures"
                  :active-step="stepsManager?.activeChaserConfig?.activeEditStep ?? 0"
                  @before-change="handleBeforeChange"
                />
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>

    <!-- Main Right Icon Bar -->
    <div class="pointer-events-auto w-12 bg-background border-l border-border flex flex-col items-center py-4 gap-2 z-20">
      <button
        v-for="cat in CHANNEL_CATEGORIES"
        :key="cat.id"
        v-show="availableTabs[cat.id] > 0"
        class="p-2 rounded-md transition-colors relative"
        :class="activeTab === cat.id ? 'bg-accent text-primary' : 'text-muted-foreground hover:text-foreground'"
        @click="toggleTab(cat.id)"
        :title="cat.label + ' Properties'"
      >
        <span 
          v-if="modifiedCategories.has(cat.id)" 
          class="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
          :class="activeTab === cat.id ? 'bg-primary' : 'bg-muted-foreground'"
        ></span>
        <component :is="cat.icon" class="size-5" />
      </button>

      <div class="flex-1"></div>

      <button
        class="p-2 rounded-md transition-colors text-muted-foreground hover:text-red-500 hover:bg-muted"
        @click="stopAllOrSelected"
        :title="stopAllTooltip"
      >
        <OctagonX class="size-5" />
      </button>
    </div>
  </div>
</template>

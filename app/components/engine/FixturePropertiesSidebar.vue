<script setup lang="ts">
import { ref, computed } from 'vue';
import { onClickOutside } from '@vueuse/core';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Lightbulb,
  Aperture,
  Move,
  Palette
} from 'lucide-vue-next';
import type { Fixture } from '~/utils/engine/core/fixture';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import type { ChannelType } from '~/utils/engine/types';
import FixturePropertyControl from './FixturePropertyControl.vue';
import { provideSidebarLock } from '~/utils/engine/composables/use-sidebar-lock';

interface Props {
  selectedIds: Set<string | number>;
  fixtures: Fixture[];
  nodes: SceneNode[]; // Need the full scene graph to resolve groups
}

const props = defineProps<Props>();

// Sidebar close lock: child dropdowns increment this to prevent auto-close
const { openCount: lockedOpenCount } = provideSidebarLock();

// Tabs logic
const activeTab = ref<string | null>(null);
const sidebarRef = ref<HTMLElement | null>(null);

onClickOutside(sidebarRef, () => {
  // Don't close the sidebar if a child floating UI (dropdown, popover) is open
  if (lockedOpenCount.value !== undefined && lockedOpenCount.value > 0) return;
  activeTab.value = null;
});

function toggleTab(tab: string) {
  if (activeTab.value === tab) {
    activeTab.value = null;
  } else {
    activeTab.value = tab;
  }
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
  const fixtures = getSelectedFixtures();
  if (fixtures.length === 0) return { intensity: 0, beam: 0, position: 0, color: 0, total: 0 };

  let intensityCount = 0, beamCount = 0, positionCount = 0, colorCount = 0;

  for (const f of fixtures) {
    if (f.channels.some(c => c.type === 'DIMMER' || c.role === 'DIMMER')) intensityCount++;
    if (f.channels.some(c => (['RED', 'GREEN', 'BLUE', 'WHITE', 'AMBER', 'UV'] as ChannelType[]).includes(c.type) || c.role === 'COLOR')) colorCount++;
    if (f.channels.some(c => (['PAN', 'TILT'] as ChannelType[]).includes(c.type))) positionCount++;
    if (f.channels.some(c => c.type === 'STROBE')) beamCount++;
  }

  return { intensity: intensityCount, beam: beamCount, position: positionCount, color: colorCount, total: fixtures.length };
});

const activeTabFixtureCount = computed(() => {
  if (!activeTab.value) return 0;
  return (availableTabs.value as Record<string, number>)[activeTab.value] ?? 0;
});

// Channel sections for the active tab ----------------------------------------

/** One channel row inside a section */
interface ChannelEntry {
  channelType: ChannelType;
  fixtures: Fixture[];
}

/** One visual section with a single label header and 1-N channel rows */
interface ChannelSection {
  name: string;    // section label ("Combined", "MH-X25", etc.)
  showLabel: boolean;
  entries: ChannelEntry[];
}

const INTENSITY_TYPES: ChannelType[] = ['DIMMER'];
const COLOR_TYPES: ChannelType[] = ['RED', 'GREEN', 'BLUE', 'WHITE', 'WARM_WHITE', 'COOL_WHITE', 'AMBER', 'UV', 'COLOR_WHEEL'];
const POSITION_TYPES: ChannelType[] = ['PAN', 'TILT'];
const BEAM_TYPES: ChannelType[] = ['STROBE'];

function tabChannelFilter(type: ChannelType): boolean {
  switch (activeTab.value) {
    case 'intensity': return INTENSITY_TYPES.includes(type);
    case 'color':     return COLOR_TYPES.includes(type);
    case 'position':  return POSITION_TYPES.includes(type);
    case 'beam':      return BEAM_TYPES.includes(type);
    default: return false;
  }
}

const channelSections = computed((): ChannelSection[] => {
  const fixtures = getSelectedFixtures();
  if (fixtures.length === 0) return [];

  const TAB_ORDER: ChannelType[] = [
    ...INTENSITY_TYPES, ...COLOR_TYPES, ...POSITION_TYPES, ...BEAM_TYPES
  ];
  const relevantTypes = TAB_ORDER.filter(t =>
    tabChannelFilter(t) && fixtures.some(f => f.channels.some(c => c.type === t))
  );
  if (relevantTypes.length === 0) return [];

  const getFixtureType = (f: Fixture): string => {
    const ext = f as Fixture & { oflShortName?: string };
    return (ext.oflShortName ?? f.name.replace(/\s+\d+$/, '')).trim();
  };

  // Labels are only shown when multiple fixture types are selected
  const allFixtureTypes = new Set(fixtures.map(getFixtureType));
  const showLabels = allFixtureTypes.size > 1;

  // Build a flat list of (channelType, fixtures, sectionName) entries
  const flat: Array<{ channelType: ChannelType; fixtures: Fixture[]; sectionName: string }> = [];

  for (const channelType of relevantTypes) {
    const fixturesWithCh = fixtures.filter(f => f.channels.some(c => c.type === channelType));

    // Sub-group by fingerprint (handles color wheels with different slot sets)
    const sigGroups = new Map<string, Fixture[]>();
    for (const f of fixturesWithCh) {
      const sig = channelFingerprint(channelType, f);
      if (!sigGroups.has(sig)) sigGroups.set(sig, []);
      sigGroups.get(sig)!.push(f);
    }

    for (const group of sigGroups.values()) {
      const groupTypes = new Set(group.map(getFixtureType));
      const sectionName = groupTypes.size > 1 ? 'Combined' : (Array.from(groupTypes)[0] ?? '');
      flat.push({ channelType, fixtures: group, sectionName });
    }
  }

  // Merge consecutive entries with the same sectionName into sections
  const sections: ChannelSection[] = [];
  for (const entry of flat) {
    const last = sections[sections.length - 1];
    if (last && last.name === entry.sectionName) {
      last.entries.push({ channelType: entry.channelType, fixtures: entry.fixtures });
    } else {
      sections.push({
        name: entry.sectionName,
        showLabel: showLabels,
        entries: [{ channelType: entry.channelType, fixtures: entry.fixtures }],
      });
    }
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
          <span v-if="activeTab && availableTabs.total > 0" class="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full whitespace-nowrap normal-case">
            {{ activeTabFixtureCount }} of {{ availableTabs.total }} Fixture{{ availableTabs.total === 1 ? '' : 's' }}
          </span>
        </div>
        
        <!-- Overlay Content -->
        <ScrollArea class="flex-1 p-4">
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
                  :key="entry.channelType"
                  :type="entry.channelType"
                  :fixtures="entry.fixtures"
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
        v-if="availableTabs.intensity > 0"
        class="p-2 rounded-md transition-colors"
        :class="activeTab === 'intensity' ? 'bg-accent text-primary' : 'text-muted-foreground hover:text-foreground'"
        @click="toggleTab('intensity')"
        title="Intensity Properties"
      >
        <Lightbulb class="size-5" />
      </button>

      <button
        v-if="availableTabs.beam > 0"
        class="p-2 rounded-md transition-colors"
        :class="activeTab === 'beam' ? 'bg-accent text-primary' : 'text-muted-foreground hover:text-foreground'"
        @click="toggleTab('beam')"
        title="Beam Properties"
      >
        <Aperture class="size-5" />
      </button>

      <button
        v-if="availableTabs.position > 0"
        class="p-2 rounded-md transition-colors"
        :class="activeTab === 'position' ? 'bg-accent text-primary' : 'text-muted-foreground hover:text-foreground'"
        @click="toggleTab('position')"
        title="Position Properties"
      >
        <Move class="size-5" />
      </button>

      <button
        v-if="availableTabs.color > 0"
        class="p-2 rounded-md transition-colors"
        :class="activeTab === 'color' ? 'bg-accent text-primary' : 'text-muted-foreground hover:text-foreground'"
        @click="toggleTab('color')"
        title="Color Properties"
      >
        <Palette class="size-5" />
      </button>
    </div>
  </div>
</template>

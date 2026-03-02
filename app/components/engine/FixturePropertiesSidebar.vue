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
import FixturePropertiesTabBar from './FixturePropertiesTabBar.vue';
import FixturePropertiesChannelList from './FixturePropertiesChannelList.vue';
import { provideSidebarLock } from '~/utils/engine/composables/use-sidebar-lock';
import { syncCategoryBeforeEdit } from '~/utils/engine/composables/use-category-sync';
import { useHistory } from '~/components/engine/composables/use-history';
import { type SnapshotMap } from './commands/set-channel-values-command';
import { useChannelValueHistory } from './composables/use-channel-value-history';
import { useChannelSections } from './composables/use-channel-sections';
import { SetModifiersCommand, cloneEffectsList } from './commands/set-modifiers-command';
interface Props {
  selectedIds: Set<string | number>;
  fixtures: Fixture[];
  nodes: SceneNode[]; // Need the full scene graph to resolve groups
}

const props = defineProps<Props>();

import type { ChannelCategoryKey } from '~/utils/engine/channel-categories';
import CategoryEffectsManager from './CategoryEffectsManager.vue';
import { inject } from 'vue';
import type { EffectEngine } from '~/utils/engine/engine';

// Effect Engine for modifying modifiers on edits
const effectEngine = inject<EffectEngine>('effectEngine');

// Sidebar close lock: child dropdowns increment this to prevent auto-close
const { openCount: lockedOpenCount } = provideSidebarLock();

// Tabs logic
const activeTab = ref<ChannelCategoryKey | null>(null);
const sidebarRef = ref<HTMLElement | null>(null);

const { captureSnapshots, commitSnapshots } = useChannelValueHistory();
const { tabChannelFilter, channelSections } = useChannelSections(activeTab, getSelectedFixtures);
const commandHistory = useHistory();

// Category Effects Manager reference to access the active configuration
const effectsManager = ref<InstanceType<typeof CategoryEffectsManager> | null>(null);

onClickOutside(
  sidebarRef,
  () => {
    // Don't close the sidebar if a child floating UI (dropdown, popover) is open
    if (lockedOpenCount.value !== undefined && lockedOpenCount.value > 0) return;
    activeTab.value = null;
    if (effectEngine) effectEngine.activeModifier.value = null;
  },
  { ignore: ['.viewport'] } // Don't close when clicking or dragging anywhere on the canvas
);

function toggleTab(tab: ChannelCategoryKey) {
  if (effectEngine) effectEngine.activeModifier.value = null;
  if (activeTab.value === tab) {
    activeTab.value = null;
  } else {
    activeTab.value = tab;
  }
}



function stopAllOrSelected() {
  const targetFixtures = props.selectedIds.size > 0 ? getSelectedFixtures() : props.fixtures;
  const snapshots = captureSnapshots(targetFixtures);
  const beforeModifiers = effectEngine ? cloneEffectsList(effectEngine.effects) : null;
  let modifiersChanged = false;
  
  for (const f of targetFixtures) {
    for (const ch of f.channels) {
      if (ch.stepValues.some(v => v !== (ch.defaultValue ?? 0)) || ch.chaserConfig) {
        ch.stepValues = [ch.defaultValue ?? 0];
        ch.value = ch.defaultValue ?? 0;
        ch.chaserConfig = undefined;
      }
    }

    if (effectEngine) {
      for (const effect of effectEngine.effects) {
        if (effect.targetFixtureIds?.includes(f.id)) {
           effect.targetFixtureIds = effect.targetFixtureIds.filter(id => id !== f.id);
           modifiersChanged = true;
        }
      }
    }
  }
  
  if (effectEngine && modifiersChanged && beforeModifiers) {
      for (let i = effectEngine.effects.length - 1; i >= 0; i--) {
        const eff = effectEngine.effects[i];
        if (eff && eff.targetFixtureIds?.length === 0) {
           effectEngine.effects.splice(i, 1);
        }
      }
      commandHistory.execute(new SetModifiersCommand(effectEngine, beforeModifiers, cloneEffectsList(effectEngine.effects), 'Stop All Modifiers'));
  }

  commitSnapshots(snapshots, 'Stop All');
}

function resetActiveTabGroup() {
  if (!activeTab.value) return;
  const fixtures = getSelectedFixtures();
  const snapshots = captureSnapshots(fixtures);
  const beforeModifiers = effectEngine ? cloneEffectsList(effectEngine.effects) : null;
  let modifiersChanged = false;
  
  for (const f of fixtures) {
    for (const ch of f.channels) {
      if (tabChannelFilter(ch.type, ch.role)) {
        ch.stepValues = [ch.defaultValue ?? 0];
        ch.value = ch.defaultValue ?? 0;
        ch.chaserConfig = undefined;
      }
    }

    if (effectEngine) {
      for (const effect of effectEngine.effects) {
         if (effect.targetFixtureIds?.includes(f.id) && effect.targetChannels?.some(t => tabChannelFilter(t))) {
           effect.targetFixtureIds = effect.targetFixtureIds.filter(id => id !== f.id);
           modifiersChanged = true;
         }
      }
    }
  }
  
  if (effectEngine && modifiersChanged && beforeModifiers) {
      for (let i = effectEngine.effects.length - 1; i >= 0; i--) {
        const eff = effectEngine.effects[i];
        if (eff && eff.targetFixtureIds?.length === 0) {
           effectEngine.effects.splice(i, 1);
        }
      }
      commandHistory.execute(new SetModifiersCommand(effectEngine, beforeModifiers, cloneEffectsList(effectEngine.effects), `Reset ${activeTab.value} Modifiers`));
  }

  commitSnapshots(snapshots, `Reset ${activeTab.value}`);
}

// ─── Category sync ────────────────────────────────────────────────────────────
// When the user touches a fader, sync all category channels from the richest fixture
// to any blank fixtures in the selection BEFORE the specific value is written.
function handleBeforeChange(fixtures: Fixture[]) {
  syncCategoryBeforeEdit(fixtures, (type, role) => tabChannelFilter(type, role), effectEngine);
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



// Computed tabs visibility -------------------------------------------------

const availableTabs = computed(() => {
  return getAvailableCategories(getSelectedFixtures());
});

// Auto-close the sidebar if the selected fixtures no longer support the active category
watch(availableTabs, (tabs) => {
  if (activeTab.value && !tabs[activeTab.value]) {
    activeTab.value = null;
    if (effectEngine) effectEngine.activeModifier.value = null;
  }
});

const activeTabFixtureCount = computed(() => {
  if (!activeTab.value) return 0;
  return availableTabs.value[activeTab.value] ?? 0;
});

// Calculate which categories have any modified values (programmed) or active modifiers
const modifiedCategories = computed<Set<ChannelCategoryKey>>(() => {
  const modified = new Set<ChannelCategoryKey>();
  const fixtures = getSelectedFixtures();
  
  for (const fixture of fixtures) {
    for (const channel of fixture.channels) {
      const isProgrammed = channel.chaserConfig || channel.stepValues.some(v => v !== (channel.defaultValue ?? 0));
      if (isProgrammed) {
        // Find which category this channel belongs to
        for (const cat of CHANNEL_CATEGORIES) {
          if (cat.id === 'intensity' && channel.role === 'DIMMER') modified.add(cat.id);
          else if (cat.id === 'color' && channel.role === 'COLOR') modified.add(cat.id);
          else if (cat.types.includes(channel.type)) modified.add(cat.id);
        }
      }
    }

    if (effectEngine) {
      for (const effect of effectEngine.effects) {
        if (effect.targetFixtureIds?.includes(fixture.id)) {
           for (const t of (effect.targetChannels || [])) {
              for (const cat of CHANNEL_CATEGORIES) {
                if (cat.id === 'intensity' && t === 'DIMMER') modified.add(cat.id);
                else if (cat.types.includes(t)) modified.add(cat.id);
              }
           }
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


</script>

<template>
  <div ref="sidebarRef" class="absolute right-0 top-0 h-full flex pointer-events-none z-50">
    
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

        <div class="flex-1 min-h-0 flex flex-col">
          <!-- Category Effects Manager (Steps & Modifiers) -->
          <CategoryEffectsManager 
            auto-close
            ref="effectsManager"
            :active-tab="activeTab"
            :fixtures="getSelectedFixtures()" 
          />
          
          <!-- Overlay Content (Faders) -->
          <ScrollArea v-show="!effectsManager || effectsManager.layerMode === 'steps'" class="flex-1 min-h-0">
            <FixturePropertiesChannelList
              class="p-4"
              :channel-sections="channelSections"
              :active-step="effectsManager?.activeChaserConfig?.activeEditStep ?? 0"
              @before-change="handleBeforeChange"
            />
          </ScrollArea>
        </div>
      </div>
    </div>

    <!-- Main Right Icon Bar -->
    <FixturePropertiesTabBar
      :available-tabs="availableTabs as any"
      :modified-categories="modifiedCategories"
      :active-tab="activeTab"
      :stop-all-tooltip="stopAllTooltip"
      @toggle-tab="toggleTab"
      @stop-all-or-selected="stopAllOrSelected"
    />
  </div>
</template>

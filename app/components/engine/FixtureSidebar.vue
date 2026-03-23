<script setup lang="ts">
import { ref, computed } from 'vue';
import type { SceneNode, FixtureGroup } from '~/utils/engine/core/group';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { Effect } from '~/utils/engine/types';
import FixtureSidebarNode from './FixtureSidebarNode.vue';
import PresetsSidebar from './PresetsSidebar.vue';
import SelectionInfoSection from './SelectionInfoSection.vue';
import { Lightbulb, Plus, SquareFunction } from 'lucide-vue-next';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarHeader,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';

const props = defineProps<{
  nodes: SceneNode[];
  selectedIds: Set<string | number>;
  fixtures: Fixture[];
  effects: Effect[];
}>();

const emit = defineEmits<{
  (e: 'select', id: string | number, multiple: boolean): void;
  (e: 'group'): void;
  (e: 'ungroup', group: FixtureGroup): void;
  (e: 'zoomTo', node: SceneNode): void;
  (e: 'requestAddFixture'): void;
  (e: 'deleteNode', node: SceneNode): void;
  (e: 'selectFixtures', ids: (string | number)[]): void;
  (e: 'openPropertiesTab', tab: string, isModifier?: boolean): void;
}>();

const activeTab = ref<'fixtures' | 'presets' | null>('fixtures');

function toggleTab(tab: 'fixtures' | 'presets') {
  activeTab.value = activeTab.value === tab ? null : tab;
}

const presetsSidebarRef = ref<{
  quickSave: () => void,
  overwriteActivePreset: () => void,
  createPresetFromSelection: (selectedIds: Set<string | number>) => void,
  hasUnsaved: boolean,
  selectedPresetId: string | null
} | null>(null);

function quickSave() {
  presetsSidebarRef.value?.quickSave();
}

function overwriteActivePreset() {
  presetsSidebarRef.value?.overwriteActivePreset();
}

function createPresetFromSelection(selectedIds: Set<string | number>) {
  presetsSidebarRef.value?.createPresetFromSelection(selectedIds);
}

defineExpose({ quickSave, overwriteActivePreset, createPresetFromSelection, presetsSidebarRef });

const selectedFixtures = computed(() =>
  props.fixtures.filter(f => props.selectedIds.has(f.id))
);
</script>

<template>
  <div class="flex h-full border-r border-border bg-sidebar">
    <!-- Main Sidebar Panel -->
    <Sidebar
      v-if="activeTab !== null"
      class="w-64 border-r border-border bg-sidebar"
      collapsible="none"
    >
      <SidebarHeader class="h-12 flex flex-row items-center justify-between px-4 border-b border-border bg-sidebar">
        <span class="font-semibold text-xs tracking-wider uppercase text-muted-foreground">
          {{ activeTab === 'fixtures' ? 'Fixtures' : 'Changes' }}
        </span>

        <!-- Add Fixture button (only visible on fixtures tab) -->
        <Button
          v-if="activeTab === 'fixtures'"
          variant="ghost"
          size="icon"
          class="size-7 text-muted-foreground hover:text-foreground"
          title="Add Fixture (Shift+A)"
          @click="emit('requestAddFixture')"
        >
          <Plus class="size-4" />
        </Button>
      </SidebarHeader>

      <SidebarContent class="p-0 bg-sidebar overflow-y-auto">
        <!-- Fixtures tab: scene tree -->
        <SidebarGroup v-show="activeTab === 'fixtures'" class="p-2">
          <SidebarMenu v-if="nodes.length > 0">
            <FixtureSidebarNode
              v-for="node in nodes"
              :key="node.id"
              :node="node"
              :selected-ids="selectedIds"
              @select="(id, mult) => emit('select', id, mult)"
              @group="emit('group')"
              @ungroup="g => emit('ungroup', g)"
              @zoom-to="n => emit('zoomTo', n)"
              @delete="n => emit('deleteNode', n)"
            />
          </SidebarMenu>
          <div v-else class="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground opacity-50">
            <Lightbulb class="size-8" />
            <p class="text-[10px] uppercase font-medium">No fixtures in scene</p>
          </div>
        </SidebarGroup>

        <!-- Presets tab -->
        <div v-show="activeTab === 'presets'" class="h-full overflow-hidden">
          <PresetsSidebar
            ref="presetsSidebarRef"
            :fixtures="fixtures"
            :effects="effects"
            :nodes="nodes"
            @select-fixtures="ids => emit('selectFixtures', ids)"
            @open-properties-tab="(tab, isMod, effId) => emit('openPropertiesTab', tab, isMod, effId)"
          />
        </div>
      </SidebarContent>

      <!-- Selection Info Section (Fixed at bottom of fixtures tab) -->
      <SelectionInfoSection
        v-if="activeTab === 'fixtures'"
        :selected-fixtures="selectedFixtures"
        :all-fixtures="fixtures"
      />
    </Sidebar>

    <!-- Activity Bar (Narrow) -->
    <div class="w-12 bg-background flex flex-col items-center py-4 gap-4 border-l border-border">
      <button
        class="p-2 rounded-md transition-colors"
        :class="activeTab === 'fixtures' ? 'bg-accent text-primary' : 'text-muted-foreground hover:text-foreground'"
        @click="toggleTab('fixtures')"
        title="Scene Fixtures"
      >
        <Lightbulb class="size-5" />
      </button>
      <button
        class="p-2 rounded-md transition-colors"
        :class="activeTab === 'presets' ? 'bg-accent text-primary' : 'text-muted-foreground hover:text-foreground'"
        @click="toggleTab('presets')"
        title="Presets"
      >
        <SquareFunction class="size-5" />
      </button>
    </div>

  </div>
</template>

<style scoped>
:deep(.bg-sidebar) {
  background-color: transparent !important;
}
</style>

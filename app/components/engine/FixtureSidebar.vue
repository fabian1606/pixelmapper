<script setup lang="ts">
import { ref } from 'vue';
import type { SceneNode, FixtureGroup } from '~/utils/engine/core/group';
import FixtureSidebarNode from './FixtureSidebarNode.vue';
import { Lightbulb, SquareFunction } from 'lucide-vue-next';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarHeader,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

const props = defineProps<{
  nodes: SceneNode[];
  selectedIds: Set<string | number>;
}>();

const emit = defineEmits<{
  (e: 'select', id: string | number, multiple: boolean): void;
  (e: 'group'): void;
  (e: 'ungroup', group: FixtureGroup): void;
  (e: 'zoomTo', node: SceneNode): void;
}>();

const activeTab = ref<'fixtures' | 'presets' | null>('fixtures');

function toggleTab(tab: 'fixtures' | 'presets') {
  if (activeTab.value === tab) {
    activeTab.value = null;
  } else {
    activeTab.value = tab;
  }
}
</script>

<template>
  <div class="flex h-full border-r border-border bg-sidebar">
    <!-- Main Sidebar Panel -->
    <Sidebar v-if="activeTab" class="w-64 border-r border-border bg-sidebar" collapsible="none">
      <SidebarHeader class="h-12 flex items-start px-4 border-b border-border bg-sidebar">
        <span class="flex items-center h-full font-semibold text-xs tracking-wider uppercase text-muted-foreground">
          {{ activeTab === 'fixtures' ? 'Fixtues' : 'Presets' }}
        </span>
      </SidebarHeader>
      <SidebarContent class="p-2 bg-sidebar">
        <SidebarGroup v-if="activeTab === 'fixtures'">
          <SidebarMenu>
             <FixtureSidebarNode 
               v-for="node in nodes" 
               :key="node.id"
               :node="node" 
               :selected-ids="selectedIds"
               @select="(id, mult) => emit('select', id, mult)"
               @group="emit('group')"
               @ungroup="g => emit('ungroup', g)"
               @zoom-to="n => emit('zoomTo', n)"
             />
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup v-else-if="activeTab === 'presets'">
          <div class="flex flex-col items-center justify-center h-40 text-muted-foreground italic text-sm">
            Presets empty
          </div>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>

    <!-- Activity Bar (Narrow) -->
    <div class="w-12 bg-background flex flex-col items-center py-4 gap-4 border-l border-border">
      <button 
        class="p-2 rounded-md transition-colors"
        :class="activeTab === 'fixtures' ? 'bg-accent text-primary' : 'text-muted-foreground hover:text-foreground'"
        @click="toggleTab('fixtures')"
        title="Fixtures"
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
/* Ensure the sidebar matches the dark theme perfectly */
:deep(.bg-sidebar) {
  background-color: transparent !important;
}
</style>

<script setup lang="ts">
import { ref } from 'vue';
import type { SceneNode, FixtureGroup } from '~/utils/engine/core/group';
import type { Fixture } from '~/utils/engine/core/fixture';
import FixtureSidebarNode from './FixtureSidebarNode.vue';
import { Lightbulb, LayoutGrid, Plus, SquareFunction } from 'lucide-vue-next';
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
}>();

const emit = defineEmits<{
  (e: 'select', id: string | number, multiple: boolean): void;
  (e: 'group'): void;
  (e: 'ungroup', group: FixtureGroup): void;
  (e: 'zoomTo', node: SceneNode): void;
  (e: 'requestAddFixture'): void;
  (e: 'deleteNode', node: SceneNode): void;
}>();

const activeTab = ref<'fixtures' | 'presets'>('fixtures');


function toggleTab(tab: 'fixtures' | 'presets') {
  activeTab.value = tab;
}
</script>

<template>
  <div class="flex h-full border-r border-border bg-sidebar">
    <!-- Main Sidebar Panel -->
    <Sidebar class="w-64 border-r border-border bg-sidebar" collapsible="none">
      <SidebarHeader class="h-12 flex flex-row items-center justify-between px-4 border-b border-border bg-sidebar">
        <span class="font-semibold text-xs tracking-wider uppercase text-muted-foreground">
          {{ activeTab === 'fixtures' ? 'Fixtures' : 'Presets' }}
        </span>
        
        <!-- Add Fixture button in header -->
        <Button 
          variant="ghost" 
          size="icon" 
          class="size-7 text-muted-foreground hover:text-foreground"
          title="Add Fixture (Shift+A)"
          @click="emit('requestAddFixture')"
        >
          <Plus class="size-4" />
        </Button>
      </SidebarHeader>

      <SidebarContent class="p-0 bg-sidebar overflow-hidden">
        <!-- Fixtures tab: scene tree -->
        <SidebarGroup v-if="activeTab === 'fixtures'" class="p-2">
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
        <SidebarGroup v-else-if="activeTab === 'presets'" class="p-4 flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
          <SquareFunction class="size-10 opacity-20" />
          <div class="text-center space-y-1">
            <p class="text-xs font-semibold">Scene Presets</p>
            <p class="text-[10px] leading-relaxed max-w-[150px]">Presets will allow you to save and recall scene layouts and effect configurations.</p>
          </div>
          <Button variant="outline" size="sm" disabled class="mt-2 text-[9px] uppercase tracking-widest">Soon</Button>
        </SidebarGroup>
      </SidebarContent>
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

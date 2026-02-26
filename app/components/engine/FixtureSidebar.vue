<script setup lang="ts">
import type { SceneNode, FixtureGroup } from '~/utils/engine/core/group';
import FixtureSidebarNode from './FixtureSidebarNode.vue';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarHeader
} from '@/components/ui/sidebar';

const props = defineProps<{
  nodes: SceneNode[];
  selectedIds: Set<string | number>;
}>();

const emit = defineEmits<{
  (e: 'select', id: string | number, multiple: boolean): void;
  (e: 'group'): void;
  (e: 'ungroup', group: FixtureGroup): void;
}>();
</script>

<template>
  <Sidebar>
    <SidebarHeader>
      <span class="font-semibold text-sm text-slate-200">Stage Layers</span>
    </SidebarHeader>
    <SidebarContent>
      <SidebarGroup>
        <SidebarMenu>
           <FixtureSidebarNode 
             v-for="node in nodes" 
             :key="node.id"
             :node="node" 
             :selected-ids="selectedIds"
             @select="(id, mult) => emit('select', id, mult)"
             @group="emit('group')"
             @ungroup="g => emit('ungroup', g)"
           />
        </SidebarMenu>
      </SidebarGroup>
    </SidebarContent>
  </Sidebar>
</template>

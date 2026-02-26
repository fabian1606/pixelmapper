<script setup lang="ts">
import { computed } from 'vue';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import { Fixture } from '~/utils/engine/core/fixture';
import { ChevronRight, ChevronDown, Spotlight, Folder } from 'lucide-vue-next';
import {
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
} from '@/components/ui/sidebar';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
} from '@/components/ui/context-menu';

const props = defineProps<{
  node: SceneNode;
  selectedIds: Set<string | number>;
}>();

const emit = defineEmits<{
  (e: 'select', id: string | number, multiple: boolean): void;
  (e: 'group'): void;
  (e: 'ungroup', group: FixtureGroup): void;
}>();

const isGroup = computed(() => props.node instanceof FixtureGroup);
const isSelected = computed(() => props.selectedIds.has(props.node.id));

function handleSelect(e: MouseEvent) {
  emit('select', props.node.id, e.shiftKey || e.metaKey || e.ctrlKey);
}
</script>

<template>
  <SidebarMenuItem v-if="!isGroup">
    <ContextMenu>
      <ContextMenuTrigger as-child>
        <SidebarMenuButton 
          :is-active="isSelected"
          @click="handleSelect"
        >
          <Spotlight class="w-4 h-4 mr-2" />
          <span>{{ node.name }}</span>
        </SidebarMenuButton>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem @click="emit('group')">
          Group Selection
          <ContextMenuShortcut>⌘G</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  </SidebarMenuItem>

  <Collapsible v-else v-model:open="(node as FixtureGroup).expanded" as-child>
    <SidebarMenuItem>
      <ContextMenu>
        <ContextMenuTrigger as-child>
          <SidebarMenuButton 
            :is-active="isSelected"
            @click="handleSelect"
          >
            <CollapsibleTrigger as-child>
              <button class="mr-1 hover:bg-slate-800 rounded p-0.5" @click.stop>
                <ChevronDown v-if="(node as FixtureGroup).expanded" class="w-3 h-3" />
                <ChevronRight v-else class="w-3 h-3" />
              </button>
            </CollapsibleTrigger>
            <span>{{ node.name }}</span>
          </SidebarMenuButton>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem @click="emit('group')">
            Group Selection
            <ContextMenuShortcut>⌘G</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem @click="emit('ungroup', node as FixtureGroup)">
            Ungroup
            <ContextMenuShortcut>⇧⌘G</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <CollapsibleContent>
        <SidebarMenuSub class="ml-4 border-l border-slate-800 pl-2">
          <!-- Recursive render -->
          <FixtureSidebarNode 
            v-for="child in (node as FixtureGroup).children" 
            :key="child.id"
            :node="child"
            :selected-ids="selectedIds"
            @select="(id, mult) => emit('select', id, mult)"
            @group="emit('group')"
            @ungroup="g => emit('ungroup', g)"
          />
        </SidebarMenuSub>
      </CollapsibleContent>
    </SidebarMenuItem>
  </Collapsible>
</template>

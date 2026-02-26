<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import { Fixture } from '~/utils/engine/core/fixture';
import { ChevronRight, ChevronDown, Spotlight, Folder } from 'lucide-vue-next';
import { useHistory } from '~/components/engine/composables/use-history';
import { RenameNodeCommand } from '~/components/engine/commands/rename-command';
import FixtureContextMenu from './FixtureContextMenu.vue';
import {
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
} from '@/components/ui/sidebar';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';

const props = defineProps<{
  node: SceneNode;
  selectedIds: Set<string | number>;
}>();

const emit = defineEmits<{
  (e: 'select', id: string | number, multiple: boolean): void;
  (e: 'group'): void;
  (e: 'ungroup', group: FixtureGroup): void;
  (e: 'zoomTo', node: SceneNode): void;
  (e: 'delete', node: SceneNode): void;
}>();

const history = useHistory();

const isGroup = computed(() => props.node instanceof FixtureGroup);
const isSelected = computed(() => props.selectedIds.has(props.node.id));

const isEditing = ref(false);
const editName = ref('');
const inputEl = ref<HTMLInputElement | null>(null);

function handleSelect(e: MouseEvent) {
  emit('select', props.node.id, e.shiftKey || e.metaKey || e.ctrlKey);
}

function startEditing() {
  editName.value = props.node.name;
  isEditing.value = true;
  nextTick(() => {
    inputEl.value?.focus();
    inputEl.value?.select();
  });
}

function saveRename() {
  if (!isEditing.value) return;
  const newName = editName.value.trim();
  if (newName && newName !== props.node.name) {
    history.execute(new RenameNodeCommand(props.node, newName));
  }
  isEditing.value = false;
}

function cancelEditing() {
  isEditing.value = false;
}
</script>

<template>
  <!-- ─── Fixture (leaf) node ─────────────────────────────────────────────── -->
  <SidebarMenuItem v-if="!isGroup">
    <FixtureContextMenu
      :node="node"
      :can-zoom="true"
      :can-group="true"
      :can-delete="true"
      @zoom-to="emit('zoomTo', node)"
      @group="emit('group')"
      @delete="emit('delete', node)"
    >
      <SidebarMenuButton :is-active="isSelected" @click="handleSelect">
        <Spotlight class="w-4 h-4 mr-2" @dblclick.stop="emit('zoomTo', node)" />
        <input
          v-if="isEditing"
          ref="inputEl"
          v-model="editName"
          class="bg-background border border-primary rounded px-1 w-full text-sm outline-none"
          @keydown.enter="saveRename"
          @keydown.esc="cancelEditing"
          @blur="saveRename"
          @click.stop
        />
        <span v-else @dblclick="startEditing">{{ node.name }}</span>
      </SidebarMenuButton>
    </FixtureContextMenu>
  </SidebarMenuItem>

  <!-- ─── Group (collapsible) node ─────────────────────────────────────────── -->
  <Collapsible v-else v-model:open="(node as FixtureGroup).expanded" as-child>
    <SidebarMenuItem>
      <FixtureContextMenu
        :node="node"
        :can-zoom="true"
        :can-group="true"
        :can-ungroup="true"
        :can-delete="true"
        @zoom-to="emit('zoomTo', node)"
        @group="emit('group')"
        @ungroup="emit('ungroup', node as FixtureGroup)"
        @delete="emit('delete', node)"
      >
        <SidebarMenuButton :is-active="isSelected" @click="handleSelect">
          <CollapsibleTrigger as-child>
            <button class="mr-1 hover:bg-accent rounded p-0.5" @click.stop @dblclick.stop="emit('zoomTo', node)">
              <ChevronDown v-if="(node as FixtureGroup).expanded" class="w-3 h-3" />
              <ChevronRight v-else class="w-3 h-3" />
            </button>
          </CollapsibleTrigger>
          <input
            v-if="isEditing"
            ref="inputEl"
            v-model="editName"
            class="bg-background border border-primary rounded px-1 w-full text-sm outline-none"
            @keydown.enter="saveRename"
            @keydown.esc="cancelEditing"
            @blur="saveRename"
            @click.stop
          />
          <span v-else @dblclick="startEditing">{{ node.name }}</span>
        </SidebarMenuButton>
      </FixtureContextMenu>

      <CollapsibleContent>
        <SidebarMenuSub class="ml-4 border-l border-border pl-2">
          <!-- Recursive render -->
          <FixtureSidebarNode
            v-for="child in (node as FixtureGroup).children"
            :key="child.id"
            :node="child"
            :selected-ids="selectedIds"
            @select="(id, mult) => emit('select', id, mult)"
            @group="emit('group')"
            @ungroup="g => emit('ungroup', g)"
            @zoom-to="n => emit('zoomTo', n)"
            @delete="n => emit('delete', n)"
          />
        </SidebarMenuSub>
      </CollapsibleContent>
    </SidebarMenuItem>
  </Collapsible>
</template>

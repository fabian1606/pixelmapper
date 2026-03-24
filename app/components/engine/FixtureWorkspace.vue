<script setup lang="ts">
import { ref, computed } from 'vue';
import { useEngineStore } from '~/stores/engine-store';
import { storeToRefs } from 'pinia';
import { useWorkspaceOperations } from './composables/use-workspace-operations';
import { usePresets } from './composables/use-presets';
import FixtureEditor from './FixtureEditor.vue';
import DeleteConfirmDialog from './DeleteConfirmDialog.vue';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import { useHistory } from './composables/use-history';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import {
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  LayoutGrid
} from 'lucide-vue-next';

const engineStore = useEngineStore();
const { sceneNodes, selectedIds, flatFixtures } = storeToRefs(engineStore);
const engine = engineStore.engine;

const { 
  handleGroup, 
  handleUngroup, 
  handleUngroupSelected, 
  handleDeleteNodes,
  handleAlign
} = useWorkspaceOperations(sceneNodes, selectedIds, flatFixtures);

const { selectedPresetId, getUnsavedChanges } = usePresets();
const history = useHistory();

const hasUnsavedChanges = computed(() => {
  history.version.value; // Force reactivity hook based on undo/redo command execution
  return getUnsavedChanges(flatFixtures.value, engine.effects, sceneNodes.value).length > 0;
});

const hasSelectedGroup = computed(() => {
  let hasGroup = false;
  function findSelected(nodes: SceneNode[]) {
    for (const node of nodes) {
      if (node instanceof FixtureGroup && selectedIds.value.has(node.id)) {
        hasGroup = true;
      }
      if (node instanceof FixtureGroup) {
        findSelected(node.children);
      }
    }
  }
  findSelected(sceneNodes.value);
  return hasGroup;
});

const deleteDialogOpen = ref(false);
const nodesPendingDelete = ref<SceneNode[]>([]);

function handleDeleteNode(node: SceneNode) {
  nodesPendingDelete.value = [node];
  deleteDialogOpen.value = true;
}

function handleDeleteSelected() {
  if (selectedIds.value.size === 0) return;

  const nodesToDelete: SceneNode[] = [];
  
  function findTopLevelSelected(nodes: SceneNode[]) {
    for (const node of nodes) {
      if (selectedIds.value.has(node.id)) {
        nodesToDelete.push(node);
      } else if (node instanceof FixtureGroup) {
        findTopLevelSelected(node.children);
      }
    }
  }
  
  findTopLevelSelected(sceneNodes.value);
  
  if (nodesToDelete.length === 0) return;

  nodesPendingDelete.value = nodesToDelete;
  deleteDialogOpen.value = true;
}

function confirmDelete() {
  handleDeleteNodes(nodesPendingDelete.value);
  nodesPendingDelete.value = [];
}

const emit = defineEmits<{
  (e: 'quick-save'): void,
  (e: 'overwrite-active-preset'): void,
  (e: 'create-preset-from-selection', ids: Set<string | number>): void,
  (e: 'bind-editor', editor: InstanceType<typeof FixtureEditor> | null): void
}>();

const fixtureEditor = ref<InstanceType<typeof FixtureEditor> | null>(null);

// Expose editor upwards so index.vue can trigger zoomTo
defineExpose({
  zoomTo: (node: SceneNode) => fixtureEditor.value?.zoomTo(node)
});
</script>

<template>
  <div class="flex-1 relative">
    
    <!-- Alignment Toolbar -->
    <div
      v-if="selectedIds.size > 1"
      class="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 p-1 rounded-md bg-background/80 backdrop-blur border border-border shadow-sm"
    >
      <Button variant="ghost" size="icon" class="h-7 w-7 text-muted-foreground hover:text-foreground" title="Align Center X" @click="handleAlign('center-x')">
        <AlignCenterVertical class="size-4" />
      </Button>
      <Button variant="ghost" size="icon" class="h-7 w-7 text-muted-foreground hover:text-foreground" title="Align Center Y" @click="handleAlign('center-y')">
        <AlignCenterHorizontal class="size-4" />
      </Button>
      <div class="w-px h-4 bg-border mx-1"></div>
      <Button variant="ghost" size="icon" class="h-7 w-7 text-muted-foreground hover:text-foreground" title="Distribute Horizontally" @click="handleAlign('distribute-x')">
        <AlignHorizontalDistributeCenter class="size-4" />
      </Button>
      <Button variant="ghost" size="icon" class="h-7 w-7 text-muted-foreground hover:text-foreground" title="Distribute Vertically" @click="handleAlign('distribute-y')">
        <AlignVerticalDistributeCenter class="size-4" />
      </Button>
      <div class="w-px h-4 bg-border mx-1"></div>
      <Button variant="ghost" size="icon" class="h-7 w-7 text-muted-foreground hover:text-foreground" title="Smart Grid" @click="handleAlign('smart-grid')">
        <LayoutGrid class="size-4" />
      </Button>
    </div>

    <ContextMenu>
      <ContextMenuTrigger as-child>
          <FixtureEditor
            ref="fixtureEditor"
            v-model:selected-ids="selectedIds"
            :fixtures="flatFixtures"
            style="border-radius: 0;"
            class="w-full h-full"
            @delete-fixture="handleDeleteNode"
            @delete-selected="handleDeleteSelected"
            @group="handleGroup"
            @ungroup="handleUngroup"
          />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem @click="handleGroup">
          Group Selection
          <ContextMenuShortcut>⌘G</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem v-if="hasSelectedGroup" @click="handleUngroupSelected">
          Ungroup
          <ContextMenuShortcut>⇧⌘G</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator v-if="selectedIds.size > 0 || hasUnsavedChanges" />
        <ContextMenuItem v-if="hasUnsavedChanges" @click="emit('quick-save')">
          Create Preset
          <ContextMenuShortcut>⇧P</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem v-if="selectedIds.size > 0" @click="emit('create-preset-from-selection', selectedIds)">
          Create Preset from Selection
        </ContextMenuItem>
        <ContextMenuItem v-if="selectedPresetId && hasUnsavedChanges" @click="emit('overwrite-active-preset')">
          Overwrite Active Preset
          <ContextMenuShortcut>⇧S</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator v-if="selectedIds.size > 0" />
        <ContextMenuItem v-if="selectedIds.size > 0" class="text-destructive focus:text-destructive" @click="handleDeleteSelected">
          Delete
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>

    <DeleteConfirmDialog
      v-model:open="deleteDialogOpen"
      :node-name="nodesPendingDelete[0]?.name || ''"
      :count="nodesPendingDelete.length"
      @confirm="confirmDelete"
    />
  </div>
</template>

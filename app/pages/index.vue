<script setup lang="ts">
import { ref, onMounted, onUnmounted, watchEffect, shallowRef, computed, nextTick } from 'vue';
import { SineEffect } from '~/utils/engine/effects/sine-effect';
import { EffectEngine } from '~/utils/engine/engine';
import { Fixture } from '~/utils/engine/core/fixture';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import DeleteConfirmDialog from '~/components/engine/DeleteConfirmDialog.vue';
import FixtureEditor from '~/components/engine/FixtureEditor.vue';
import FixtureSidebar from '~/components/engine/FixtureSidebar.vue';
import FixturePropertiesSidebar from '~/components/engine/FixturePropertiesSidebar.vue';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useHistory } from '~/components/engine/composables/use-history';
import { GroupNodesCommand, UngroupNodesCommand } from '~/components/engine/commands/group-command';
import { DeleteNodesCommand } from '~/components/engine/commands/delete-node-command';
import { AddFixturesCommand } from '~/components/engine/commands/add-fixture-command';
import AddFixtureDialog from '~/components/engine/AddFixtureDialog.vue';
import { useShortcuts } from '~/components/engine/composables/use-shortcuts';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
} from '@/components/ui/context-menu';
import { usePresets } from '~/components/engine/composables/use-presets';

const COLS = 5;
const ROWS = 4;
const fixtureCount = COLS * ROWS;
const engine = new EffectEngine();
const history = useHistory();

// Create fixtures in a grid layout (normalized 0-1 positions)
const stepX = 0.04;
const stepY = 0.06;
const startX = 0.5 - (9 * stepX) / 2; // 9 steps for 10 columns
const startY = 0.5 - (3 * stepY) / 2; // 3 steps for 4 rows

const fixtures = Array.from({ length: fixtureCount }, (_, i) => {
  const row = Math.floor(i / COLS);
  const col = i % COLS;
  
  const fixture = Fixture.createRGBFixture(i);
  if (i === 0) fixture.name = 'Front Left';
  if (i === 9) fixture.name = 'Front Right';
  if (i === 30) fixture.name = 'Back Left';
  if (i === 39) fixture.name = 'Back Right';

  fixture.fixturePosition = {
    x: startX + col * stepX,
    y: startY + row * stepY,
  };
  fixture.fixtureSize = {
    x: 1,
    y: 1,
  };
  return fixture;
});

const sceneNodes = ref<SceneNode[]>([...fixtures]);
const selectedIds = ref<Set<string | number>>(new Set());

// Flat fixtures computed property for the engine and editor
const flatFixtures = computed(() => {
  const result: Fixture[] = [];
  function traverse(nodes: SceneNode[]) {
    for (const node of nodes) {
      if (node instanceof FixtureGroup) traverse(node.children);
      else result.push(node as Fixture);
    }
  }
  traverse(sceneNodes.value);
  return result;
});

// Global Base Values (all max for demo on index)
const globalBases = ref<Record<string, number>>({
  RED: 0,
  GREEN: 0,
  BLUE: 0,
  DIMMER: 255,
});



import { provide } from 'vue';
provide('effectEngine', engine);

// Sync base values — only apply to channels that have not been programmed
// (i.e. channels where stepValues[0] is still default/zero and no chaser is set)
watchEffect(() => {
  for (const fixture of flatFixtures.value) {
    for (const channel of fixture.channels) {
      const base = globalBases.value[channel.type];
      if (base !== undefined) {
        // Skip channels that have been explicitly programmed by the user
        const isProgrammed = channel.chaserConfig || channel.stepValues.some(v => v !== 0);
        if (!isProgrammed) {
          channel.stepValues[0] = base;
          channel.currentBaseValue = base;
        }
      }
    }
  }
});


// Reactive color map — updated every frame, consumed by FixtureEditor
const fixtureColors = shallowRef<Map<string | number, string>>(new Map());

let animFrameId: number;
const startTime = performance.now();
let lastTime = startTime;

const renderLoop = (time: number) => {
  const elapsed = time - startTime;
  const deltaTime = time - lastTime;
  lastTime = time;

  engine.render(flatFixtures.value, elapsed, deltaTime);

  // Rebuild color map each frame so FixtureEditor stays live
  const colorMap = new Map<string | number, string>();
  for (const f of flatFixtures.value) {
    colorMap.set(f.id, f.resolveColor());
  }
  fixtureColors.value = colorMap;

  animFrameId = requestAnimationFrame(renderLoop);
};

// Window sizing
const windowWidth = ref(1024);
const windowHeight = ref(768);

const updateSize = () => {
  if (typeof window !== 'undefined') {
    // subtract sidebar width approx 256px
    windowWidth.value = window.innerWidth - 256; 
    windowHeight.value = window.innerHeight;
  }
};

const fixtureEditor = ref<InstanceType<typeof FixtureEditor> | null>(null);

function handleZoomTo(node: SceneNode) {
  fixtureEditor.value?.zoomTo(node);
}

function handleSelectFixtures(ids: (string | number)[]) {
  selectedIds.value = new Set(ids);
}

const propertiesSidebarRef = ref<InstanceType<typeof FixturePropertiesSidebar> | null>(null);
const fixtureSidebarRef = ref<{ 
  quickSave: () => void,
  overwriteActivePreset: () => void,
  createPresetFromSelection: (selectedIds: Set<string | number>) => void
} | null>(null);

function handleOpenPropertiesTab(tab: string, isModifier?: boolean) {
  nextTick(() => propertiesSidebarRef.value?.openTab(tab, isModifier));
}

// Preset Context Menu Actions
const { selectedPresetId, getUnsavedChanges } = usePresets();

const hasUnsavedChanges = computed(() => {
  return getUnsavedChanges(flatFixtures.value, engine.effects, sceneNodes.value).length > 0;
});

function handleCreatePreset() {
  fixtureSidebarRef.value?.quickSave();
}

function handleOverwritePreset() {
  fixtureSidebarRef.value?.overwriteActivePreset();
}

function handleCreatePresetFromSelection() {
  if (selectedIds.value.size > 0) {
    fixtureSidebarRef.value?.createPresetFromSelection(selectedIds.value);
  }
}

// Selection / Groups logic
function handleSelect(id: string | number, multiple: boolean) {
  if (multiple) {
    const next = new Set(selectedIds.value);
    next.has(id) ? next.delete(id) : next.add(id);
    selectedIds.value = next;
  } else {
    selectedIds.value = new Set([id]);
  }
}

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

let nextGroupId = 1;
let nextFixtureId = fixtureCount;

const addDialogOpen = ref(false);

function handleAddOflFixtures(fixtures: Fixture[]) {
  // 1. Prepare fixtures (assign IDs and positions)
  fixtures.forEach((f, i) => {
    f.id = `ofl-${nextFixtureId++}`;
    // Spread them out slightly if multiple
    f.fixturePosition = { 
      x: 0.5 + (i * 0.02), 
      y: 0.5 + (i * 0.02) 
    };
  });

  // 2. Execute history command
  const command = new AddFixturesCommand(sceneNodes.value, fixtures);
  history.execute(command);
  
  // 3. Select the new fixtures
  const next = new Set(selectedIds.value);
  for (const f of fixtures) {
    next.add(f.id);
  }
  selectedIds.value = next;
}


function handleGroup() {
  if (selectedIds.value.size === 0) return;
  
  const nodesToGroup: SceneNode[] = [];
  function findNodes(nodes: SceneNode[]) {
    for (const node of nodes) {
      if (selectedIds.value.has(node.id)) {
        nodesToGroup.push(node);
      } else if (node instanceof FixtureGroup) {
        findNodes(node.children);
      }
    }
  }
  findNodes(sceneNodes.value);

  if (nodesToGroup.length === 0) return;

  const newGroup = new FixtureGroup(`group-${nextGroupId++}`, 'New Group');
  const command = new GroupNodesCommand(sceneNodes.value, nodesToGroup, newGroup);
  history.execute(command);
  selectedIds.value = new Set([newGroup.id]);
}

function handleUngroup(group: FixtureGroup) {
  const command = new UngroupNodesCommand(sceneNodes.value, group);
  history.execute(command);
  selectedIds.value = new Set(group.children.map(c => c.id));
}

function handleUngroupSelected() {
  const groupsToUngroup: FixtureGroup[] = [];
  function findGroups(nodes: SceneNode[]) {
    for (const node of nodes) {
      if (node instanceof FixtureGroup && selectedIds.value.has(node.id)) {
        groupsToUngroup.push(node);
      }
      if (node instanceof FixtureGroup) {
        findGroups(node.children);
      }
    }
  }
  findGroups(sceneNodes.value);
  for (const g of groupsToUngroup) {
    handleUngroup(g);
  }
}

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
  if (nodesPendingDelete.value.length === 0) return;

  const command = new DeleteNodesCommand(sceneNodes.value, nodesPendingDelete.value);
  history.execute(command);
  
  // Clear selection
  selectedIds.value = new Set();
  nodesPendingDelete.value = [];
}

// ─── Keyboard Shortcuts ───────────────────────────────────────────────────────
useShortcuts([
  // History
  { key: 'z',      ctrl: true,                label: 'Undo',            handler: () => history.undo() },
  { key: 'z',      ctrl: true, shift: true,   label: 'Redo',            handler: () => history.redo() },
  { key: 'y',      ctrl: true,                label: 'Redo',            handler: () => history.redo() },
  // Scene operations
  { key: 'g',      ctrl: true,                label: 'Group',           handler: handleGroup },
  { key: 'g',      ctrl: true, shift: true,   label: 'Ungroup',         handler: handleUngroupSelected },
  // Deletion — only when something is selected
  { key: 'Delete',    label: 'Delete Selected', handler: handleDeleteSelected },
  { key: 'Backspace', label: 'Delete Selected', handler: handleDeleteSelected },
  // Add fixture
  { key: 'a',      shift: true,               label: 'Add Fixture',     handler: () => { addDialogOpen.value = true; } },
  // Presets
  { key: 'p',      shift: true,               label: 'Save as Preset',  handler: () => fixtureSidebarRef.value?.quickSave() },
]);

onMounted(() =>  { animFrameId = requestAnimationFrame(renderLoop); });
onUnmounted(() => { cancelAnimationFrame(animFrameId); });
</script>

<template>
  <SidebarProvider>
    <div class="flex h-screen w-screen bg-background overflow-hidden text-foreground font-sans m-0 p-0">
      <FixtureSidebar
        ref="fixtureSidebarRef"
        class="shrink-0"
        :nodes="sceneNodes"
        :selected-ids="selectedIds"
        :fixtures="flatFixtures"
        :effects="engine.effects"
        @select="handleSelect"
        @group="handleGroup"
        @ungroup="handleUngroup"
        @zoom-to="handleZoomTo"
        @request-add-fixture="addDialogOpen = true"
        @delete-node="handleDeleteNode"
        @select-fixtures="handleSelectFixtures"
        @open-properties-tab="handleOpenPropertiesTab"
      />
      <main class="flex-1 relative">
        <ContextMenu>
          <ContextMenuTrigger as-child>
              <FixtureEditor
                ref="fixtureEditor"
                v-model:selected-ids="selectedIds"
                :fixtures="flatFixtures"
                :colors="fixtureColors"
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
            <ContextMenuItem v-if="hasUnsavedChanges" @click="handleCreatePreset">
              Create Preset
              <ContextMenuShortcut>⇧P</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem v-if="selectedIds.size > 0" @click="handleCreatePresetFromSelection">
              Create Preset from Selection
            </ContextMenuItem>
            <ContextMenuItem v-if="selectedPresetId && hasUnsavedChanges" @click="handleOverwritePreset">
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
        <FixturePropertiesSidebar ref="propertiesSidebarRef" :selected-ids="selectedIds" :fixtures="flatFixtures" :nodes="sceneNodes" />
      </main>
    </div>
  </SidebarProvider>

  <DeleteConfirmDialog
    v-model:open="deleteDialogOpen"
    :node-name="nodesPendingDelete[0]?.name || ''"
    :count="nodesPendingDelete.length"
    @confirm="confirmDelete"
  />

  <AddFixtureDialog 
    v-model:open="addDialogOpen" 
    @add="handleAddOflFixtures"
  />
</template>

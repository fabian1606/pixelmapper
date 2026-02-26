<script setup lang="ts">
import { ref, onMounted, onUnmounted, watchEffect, shallowRef, computed } from 'vue';
import { SineEffect } from '~/utils/engine/effects/sine-effect';
import { EffectEngine } from '~/utils/engine/engine';
import { Fixture } from '~/utils/engine/core/fixture';
import { RedChannel, GreenChannel, BlueChannel, DimmerChannel } from '~/utils/engine/core/channel';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import FixtureEditor from '~/components/engine/FixtureEditor.vue';
import FixtureSidebar from '~/components/engine/FixtureSidebar.vue';
import { SidebarProvider } from '@/components/ui/sidebar';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut
} from '@/components/ui/context-menu';
import { useHistory } from '~/components/engine/composables/use-history';
import { GroupNodesCommand, UngroupNodesCommand } from '~/components/engine/commands/group-command';

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
  
  const fixture = new Fixture(i, [new RedChannel(), new GreenChannel(), new BlueChannel(), new DimmerChannel()]);
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

// SineEffect for some motion
const sine = new SineEffect();
sine.speed = 0.005;
sine.strength = 100;
sine.fanning = 0.5;
sine.targetChannel = 'GREEN';
sine.direction = 'FORWARD';
engine.addEffect(sine);

// Sync base values
watchEffect(() => {
  for (const fixture of flatFixtures.value) {
    for (const channel of fixture.channels) {
      const base = globalBases.value[channel.type];
      if (base !== undefined) channel.baseValue = base;
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

function handleKeyDown(e: KeyboardEvent) {
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return;
  if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); history.undo(); }
  if (e.key === 'z' &&  e.shiftKey) { e.preventDefault(); history.redo(); }
  if (e.key === 'y')                { e.preventDefault(); history.redo(); }
  if (e.key.toLowerCase() === 'g' && !e.shiftKey) { e.preventDefault(); handleGroup(); }
  if (e.key.toLowerCase() === 'g' && e.shiftKey) { e.preventDefault(); handleUngroupSelected(); }
}

onMounted(() => { 
  window.addEventListener('keydown', handleKeyDown);
  animFrameId = requestAnimationFrame(renderLoop); 
});

onUnmounted(() => { 
  window.removeEventListener('keydown', handleKeyDown);
  cancelAnimationFrame(animFrameId); 
});
</script>

<template>
  <SidebarProvider>
    <div class="flex h-screen w-screen bg-background overflow-hidden text-foreground font-sans m-0 p-0">
      <FixtureSidebar 
        class="shrink-0"
        :nodes="sceneNodes"
        :selected-ids="selectedIds"
        @select="handleSelect"
        @group="handleGroup"
        @ungroup="handleUngroup"
        @zoom-to="handleZoomTo"
      />
      <main class="flex-1 relative">
        <ContextMenu>
          <ContextMenuTrigger as-child>
            <div class="w-full h-full">
              <FixtureEditor 
                ref="fixtureEditor"
                v-model:selected-ids="selectedIds"
                :fixtures="flatFixtures" 
                :colors="fixtureColors" 
                class="w-full h-full"
              />
            </div>
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
          </ContextMenuContent>
        </ContextMenu>
      </main>
    </div>
  </SidebarProvider>
</template>

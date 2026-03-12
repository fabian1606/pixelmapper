<script setup lang="ts">
defineOptions({ inheritAttrs: false });
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { SpatialVector } from '~/utils/engine/types';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import FixtureCanvas from './FixtureCanvas.vue';
import FixtureNode from './FixtureNode.vue';
import FixtureEditorSpatialControls from './FixtureEditorSpatialControls.vue';
import { useCamera } from './composables/use-camera';
import { useSelection } from './composables/use-selection';
import { useHistory } from './composables/use-history';
import { MoveFixtureCommand } from './commands/move-fixture-command';
import { RotateFixtureCommand } from './commands/rotate-fixture-command';
import { inject } from 'vue';
import type { EffectEngine } from '~/utils/engine/engine';
import { SetModifiersCommand, cloneEffectsList } from './commands/set-modifiers-command';
import type { Effect } from '~/utils/engine/types';

interface Props {
  fixtures: Fixture[];
  colors: Map<string | number, string>;
  width?: number;
  height?: number;
}

interface Emits {
  (e: 'deleteFixture', fixture: Fixture): void;
  (e: 'delete-selected'): void;
  (e: 'group'): void;
  (e: 'ungroup', group: FixtureGroup): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

import { WORLD_WIDTH, WORLD_HEIGHT, FIXTURE_RADIUS } from '~/utils/engine/constants';

// ─── Responsive Sizing ───────────────────────────────────────────────────────
const viewportEl = ref<HTMLElement | null>(null);
import { useEditorViewport } from './composables/use-editor-viewport';

const { editorWidth, editorHeight } = useEditorViewport(
  viewportEl,
  props.width || 800,
  props.height || 600,
  () => {
    if (props.fixtures.length > 0) zoomToFit();
  },
  () => {
    fixtureCanvas.value?.draw();
  }
);

// ─── Composables ─────────────────────────────────────────────────────────────
const { camera, viewportToWorld, worldToViewport, onWheel, centerOn, fitAll } = useCamera();
const history = useHistory();
function handleDeleteRequest(fixture: Fixture) {
  // If the fixture is part of the current selection, delete the entire selection
  if (selectedIds.value.has(fixture.id)) {
    emit('delete-selected');
  } else {
    emit('deleteFixture', fixture);
  }
}

// ─── Zoom to Node ────────────────────────────────────────────────────────────
function zoomTo(node: SceneNode) {
  let avgPos = { x: 0, y: 0 };

  if (node instanceof FixtureGroup) {
    const groupFixtures = node.getAllFixtures();
    if (groupFixtures.length === 0) return;
    avgPos.x = groupFixtures.reduce((sum: number, f: Fixture) => sum + f.fixturePosition.x, 0) / groupFixtures.length;
    avgPos.y = groupFixtures.reduce((sum: number, f: Fixture) => sum + f.fixturePosition.y, 0) / groupFixtures.length;
  } else {
    avgPos.x = (node as Fixture).fixturePosition.x;
    avgPos.y = (node as Fixture).fixturePosition.y;
  }

  if (camera.scale < 1.0) {
    camera.scale = 1.0;
  }

  centerOn(avgPos.x * WORLD_WIDTH, avgPos.y * WORLD_HEIGHT, editorWidth.value, editorHeight.value);
}

/** Fit all fixtures into the viewport. */
function zoomToFit() {
  const points = props.fixtures.map(f => ({
    wx: f.fixturePosition.x * WORLD_WIDTH,
    wy: f.fixturePosition.y * WORLD_HEIGHT,
  }));
  fitAll(points, editorWidth.value, editorHeight.value);
  fixtureCanvas.value?.draw();
}

defineExpose({ zoomTo, zoomToFit });

const selectedIdsModel = defineModel<Set<string | number>>('selectedIds', { default: () => new Set() });

const { selectedIds, interaction, onViewportMouseDown, onDragStart, onRotateStart, onMouseMove, onMouseUp } =
  useSelection(
    () => props.fixtures,
    () => WORLD_WIDTH,
    () => WORLD_HEIGHT,
    viewportToWorld,
    (before, after) => {
      history.execute(new MoveFixtureCommand(props.fixtures, before, after));
    },
    (before, after) => {
      history.execute(new RotateFixtureCommand(props.fixtures, before, after));
    },
    selectedIdsModel
  );

// Clear the active modifier (and spatial handle) if the user deselects everything
watch(selectedIdsModel, (newVal) => {
  if (effectEngine && newVal.size === 0) {
    effectEngine.activeModifier.value = null;
  }
});

// ─── Refs ─────────────────────────────────────────────────────────────────────
const fixtureCanvas = ref<InstanceType<typeof FixtureCanvas> | null>(null);

function rect(): DOMRect {
  return viewportEl.value!.getBoundingClientRect();
}

// ─── Fixture visibility / screen position ─────────────────────────────────────
function isFixtureVisible(f: Fixture): boolean {
  const pos    = worldToViewport(f.fixturePosition.x * WORLD_WIDTH, f.fixturePosition.y * WORLD_HEIGHT);
  const maxSize = Math.max(f.fixtureSize?.x ?? 1, f.fixtureSize?.y ?? 1);
  const r      = maxSize * FIXTURE_RADIUS * camera.scale;
  const margin = r + 20;
  return (
    pos.x + margin >= 0 && pos.x - margin <= editorWidth.value &&
    pos.y + margin >= 0 && pos.y - margin <= editorHeight.value
  );
}

function getFixtureScreenPos(f: Fixture) {
  return worldToViewport(f.fixturePosition.x * WORLD_WIDTH, f.fixturePosition.y * WORLD_HEIGHT);
}

function isFixtureSelected(f: Fixture): boolean {
  let curr: SceneNode | null = f as unknown as SceneNode;
  while (curr) {
    if (selectedIds.value.has(curr.id)) return true;
    curr = curr.parent;
  }
  return false;
}

const effectEngine = inject<EffectEngine>('effectEngine');

// Computed so Vue's template reactivity correctly tracks changes to activeModifier.value
const activeModifier = computed(() => effectEngine?.activeModifier.value ?? null);

let modifierDragBeforeEffects: Effect[] | null = null;

const isSpatialDragging = ref(false);

function handleModifierChange(modifier: Effect, changes: Partial<Effect>) {
  if (!effectEngine) return;
  if (!modifierDragBeforeEffects) {
    modifierDragBeforeEffects = cloneEffectsList(effectEngine.effects);
  }
  Object.assign(modifier, changes);
}

function handleSpatialDragStart(type: 'origin' | 'endpoint') {
  isSpatialDragging.value = true;
}

function handleModifierDragEnd(modifier: Effect) {
  isSpatialDragging.value = false;
  if (modifierDragBeforeEffects && effectEngine) {
    const afterEffects = cloneEffectsList(effectEngine.effects);
    history.execute(new SetModifiersCommand(effectEngine, modifierDragBeforeEffects, afterEffects, 'Update Spatial Handle'));
    modifierDragBeforeEffects = null;
  }
}

// ─── Viewport event delegation ─────────────────────────────────────────────────
function handleWheel(e: WheelEvent)     { onWheel(e, rect()); }
function handleMouseDown(e: MouseEvent) { onViewportMouseDown(e, rect()); }
function handleDragStart(e: MouseEvent, f: Fixture) { onDragStart(e, f, rect()); }
function handleRotateStart(e: MouseEvent, f: Fixture) { onRotateStart(e, f, rect()); }
function handleMouseMove(e: MouseEvent) { onMouseMove(e, rect()); fixtureCanvas.value?.draw(); }
function handleMouseUp()                { onMouseUp(); fixtureCanvas.value?.draw(); }
</script>

<template>
  <div
    ref="viewportEl"
    v-bind="$attrs"
    class="viewport"
    @wheel.prevent="handleWheel"
    @mousedown="handleMouseDown"
    @mousemove="handleMouseMove"
    @mouseup="handleMouseUp"
    @mouseleave="handleMouseUp"
  >
    <!-- Canvas: grid, fixture glows, marquee -->
    <FixtureCanvas
      ref="fixtureCanvas"
      :fixtures="fixtures"
      :colors="colors"
      :dmx-buffer="effectEngine?.dmxBuffer"
      :interaction="interaction"
      :camera="camera"
      :world-width="WORLD_WIDTH"
      :world-height="WORLD_HEIGHT"
      :viewport-width="editorWidth"
      :viewport-height="editorHeight"
    />

    <!-- Effect Spatial Preview (Rendered behind fixtures, above canvas grid) -->
    <div
      v-if="isSpatialDragging && activeModifier && activeModifier.getPreviewCSS"
      class="absolute left-0 top-0 pointer-events-none transition-opacity duration-200"
      :style="{
        width: `${WORLD_WIDTH}px`,
        height: `${WORLD_HEIGHT}px`,
        transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
        transformOrigin: '0 0',
      }"
    >
      <div 
        class="pointer-events-none" 
        :style="activeModifier.getPreviewCSS({ 
          worldWidth: WORLD_WIDTH, 
          worldHeight: WORLD_HEIGHT, 
          camera, 
          viewportWidth: editorWidth, 
          viewportHeight: editorHeight 
        })" 
      />
    </div>

    <FixtureEditorSpatialControls
      v-if="activeModifier && activeModifier.fanning !== 0"
      :viewport-el="viewportEl"
      :editor-width="editorWidth"
      :editor-height="editorHeight"
      :camera="camera"
      :active-modifier="activeModifier"
      :world-width="WORLD_WIDTH"
      :world-height="WORLD_HEIGHT"
      :world-to-viewport="worldToViewport"
      @dragStart="handleSpatialDragStart"
      @modifierChange="handleModifierChange"
      @modifierDragEnd="handleModifierDragEnd"
      @redraw="() => fixtureCanvas?.draw()"
    />

    <!-- World Container for O(1) Camera panning/zooming -->
    <div
      class="world-container absolute left-0 top-0 origin-top-left pointer-events-none"
      :style="{
        width: `${WORLD_WIDTH}px`,
        height: `${WORLD_HEIGHT}px`,
        transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.scale})`,
      }"
    >
      <template v-for="fixture in fixtures" :key="fixture.id">
        <!-- We use pointer-events-auto here because the world-container disables them -->
        <FixtureNode
          class="pointer-events-auto"
          :fixture="fixture"
          :radius="FIXTURE_RADIUS"
          :is-selected="isFixtureSelected(fixture)"
          :is-dragging="interaction.type === 'drag' && interaction.startPositions?.has(fixture.id)"
          :show-labels="camera.scale > 1.2"
          :style="{
            transform: `translate3d(calc(${fixture.fixturePosition.x * WORLD_WIDTH}px - 50%), calc(${fixture.fixturePosition.y * WORLD_HEIGHT}px - 50%), 0)`,
          }"
          @dragstart="handleDragStart($event, fixture)"
          @rotatestart="handleRotateStart($event, fixture)"
          @delete="handleDeleteRequest"
          @group="emit('group')"
          @ungroup="g => emit('ungroup', g)"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.viewport {
  position: relative;
  background: #101010;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  overflow: hidden;
  cursor: crosshair;
  user-select: none;
  outline: none;
}

.gradient-svg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
</style>

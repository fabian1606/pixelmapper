<script setup lang="ts">
defineOptions({ inheritAttrs: false });
import { ref, computed, onMounted, onUnmounted } from 'vue';
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

interface Props {
  fixtures: Fixture[];
  colors: Map<string | number, string>;
  width?: number;
  height?: number;
}

interface Emits {
  (e: 'spatialChange', fixture: Fixture, vector: SpatialVector): void;
  (e: 'deleteFixture', fixture: Fixture): void;
  (e: 'delete-selected'): void;
  (e: 'group'): void;
  (e: 'ungroup', group: FixtureGroup): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const FIXTURE_RADIUS = 18;
const WORLD_WIDTH    = 3000;
const WORLD_HEIGHT   = 3000;

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

const { selectedIds, interaction, onViewportMouseDown, onDragStart, onMouseMove, onMouseUp } =
  useSelection(
    () => props.fixtures,
    () => WORLD_WIDTH,
    () => WORLD_HEIGHT,
    viewportToWorld,
    (before, after) => {
      history.execute(new MoveFixtureCommand(props.fixtures, before, after));
    },
    selectedIdsModel
  );

// ─── Refs ─────────────────────────────────────────────────────────────────────
const fixtureCanvas = ref<InstanceType<typeof FixtureCanvas> | null>(null);

function rect(): DOMRect {
  return viewportEl.value!.getBoundingClientRect();
}

// ─── Fixture visibility / screen position ─────────────────────────────────────
function isFixtureVisible(f: Fixture): boolean {
  const pos    = worldToViewport(f.fixturePosition.x * WORLD_WIDTH, f.fixturePosition.y * WORLD_HEIGHT);
  const r      = (f.fixtureSize?.x ?? 1) * FIXTURE_RADIUS * camera.scale;
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

// ─── Single selected fixture (gradient handle is only rendered for exactly 1) ──
const selectedFixture = computed<Fixture | null>(() => {
  if (selectedIds.value.size !== 1) return null;
  const id = [...selectedIds.value][0];
  return props.fixtures.find(f => f.id === id) ?? null;
});



// ─── Viewport event delegation ─────────────────────────────────────────────────
function handleWheel(e: WheelEvent)     { onWheel(e, rect()); }
function handleMouseDown(e: MouseEvent) { onViewportMouseDown(e, rect()); }
function handleDragStart(e: MouseEvent, f: Fixture) { onDragStart(e, f, rect()); }
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
      :interaction="interaction"
      :camera="camera"
      :world-width="WORLD_WIDTH"
      :world-height="WORLD_HEIGHT"
      :viewport-width="editorWidth"
      :viewport-height="editorHeight"
    />

    <FixtureEditorSpatialControls
      :viewport-el="viewportEl"
      :editor-width="editorWidth"
      :editor-height="editorHeight"
      :camera="camera"
      :selected-fixture="selectedFixture"
      :world-width="WORLD_WIDTH"
      :world-height="WORLD_HEIGHT"
      :world-to-viewport="worldToViewport"
      @spatialChange="(f, v) => emit('spatialChange', f, v)"
      @redraw="() => fixtureCanvas?.draw()"
    />

    <!-- Fixture interaction shells -->
    <template v-for="fixture in fixtures" :key="fixture.id">
      <FixtureNode
        v-if="isFixtureVisible(fixture)"
        :fixture="fixture"
        :radius="(fixture.fixtureSize?.x ?? 1) * FIXTURE_RADIUS * camera.scale"
        :is-selected="isFixtureSelected(fixture)"
        :is-dragging="interaction.type === 'drag' && interaction.startPositions?.has(fixture.id)"
        :show-labels="camera.scale > 1.2"
        :style="{
          left: `${getFixtureScreenPos(fixture).x}px`,
          top:  `${getFixtureScreenPos(fixture).y}px`,
          transform: 'translate(-50%, -50%)',
        }"
        @dragstart="handleDragStart($event, fixture)"
        @delete="handleDeleteRequest"
        @group="emit('group')"
        @ungroup="g => emit('ungroup', g)"
      />
    </template>
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

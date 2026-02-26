<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { SpatialVector } from '~/utils/engine/types';
import { FixtureGroup, type SceneNode } from '~/utils/engine/core/group';
import FixtureCanvas from './FixtureCanvas.vue';
import FixtureNode from './FixtureNode.vue';
import SpatialHandle from './SpatialHandle.vue';
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
}

const props = withDefaults(defineProps<Props>(), {
  width:  680,
  height: 420,
});

const emit = defineEmits<Emits>();

const FIXTURE_RADIUS = 18;
const WORLD_WIDTH    = 3000;
const WORLD_HEIGHT   = 3000;

// ─── Composables ─────────────────────────────────────────────────────────────
const { camera, viewportToWorld, worldToViewport, onWheel, centerOn } = useCamera();
const history = useHistory();

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

  // Zoom in a bit if we're zoomed far out
  if (camera.scale < 1.0) {
    camera.scale = 1.0;
  }

  centerOn(avgPos.x * WORLD_WIDTH, avgPos.y * WORLD_HEIGHT, props.width, props.height);
}

defineExpose({ zoomTo });

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
const viewportEl    = ref<HTMLElement | null>(null);
const fixtureCanvas = ref<InstanceType<typeof FixtureCanvas> | null>(null);

function rect(): DOMRect {
  return viewportEl.value!.getBoundingClientRect();
}

// ─── Single selected fixture (gradient handle is only rendered for exactly 1) ──
const selectedFixture = computed<Fixture | null>(() => {
  if (selectedIds.value.size !== 1) return null;
  const id = [...selectedIds.value][0];
  return props.fixtures.find(f => f.id === id) ?? null;
});

// ─── Gradient handle viewport positions ───────────────────────────────────────
function getOriginViewportPos(f: Fixture) {
  const cfg = f.spatialConfig;
  return worldToViewport(cfg.originX * WORLD_WIDTH, cfg.originY * WORLD_HEIGHT);
}

function getEndViewportPos(f: Fixture) {
  const cfg = f.spatialConfig;
  const ex = cfg.originX * WORLD_WIDTH  + Math.cos(cfg.angle) * cfg.magnitude * WORLD_WIDTH;
  const ey = cfg.originY * WORLD_HEIGHT + Math.sin(cfg.angle) * cfg.magnitude * WORLD_WIDTH;
  return worldToViewport(ex, ey);
}

// ─── Fixture visibility / screen position ─────────────────────────────────────
function isFixtureVisible(f: Fixture): boolean {
  const pos    = worldToViewport(f.fixturePosition.x * WORLD_WIDTH, f.fixturePosition.y * WORLD_HEIGHT);
  const r      = (f.fixtureSize?.x ?? 1) * FIXTURE_RADIUS * camera.scale;
  const margin = r + 20;
  return (
    pos.x + margin >= 0 && pos.x - margin <= props.width &&
    pos.y + margin >= 0 && pos.y - margin <= props.height
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

// ─── Gradient handle drag (window-global for reliable capture) ─────────────────
type HandleDragType = 'origin' | 'endpoint' | null;
let spatialDragType: HandleDragType = null;

function handleOriginDragStart(e: MouseEvent) {
  spatialDragType = 'origin';
  window.addEventListener('mousemove', handleWindowMouseMove);
  window.addEventListener('mouseup',   handleWindowMouseUp);
}

function handleEndpointDragStart(e: MouseEvent) {
  spatialDragType = 'endpoint';
  window.addEventListener('mousemove', handleWindowMouseMove);
  window.addEventListener('mouseup',   handleWindowMouseUp);
}

function handleWindowMouseMove(e: MouseEvent) {
  const f = selectedFixture.value;
  if (!f || !spatialDragType) return;

  const r = viewportEl.value?.getBoundingClientRect();
  if (!r) return;

  // Convert viewport mouse to world coordinates
  const vx = e.clientX - r.left;
  const vy = e.clientY - r.top;
  const wx = (vx - camera.x) / camera.scale;
  const wy = (vy - camera.y) / camera.scale;
  const cfg = f.spatialConfig;

  if (spatialDragType === 'origin') {
    cfg.originX = wx / WORLD_WIDTH;
    cfg.originY = wy / WORLD_HEIGHT;
  } else if (spatialDragType === 'endpoint') {
    const ox = cfg.originX * WORLD_WIDTH;
    const oy = cfg.originY * WORLD_HEIGHT;
    const dx = wx - ox;
    const dy = wy - oy;
    cfg.angle     = Math.atan2(dy, dx);
    cfg.magnitude = Math.sqrt(dx * dx + dy * dy) / WORLD_WIDTH;
  }

  emit('spatialChange', f, { ...f.spatialConfig });
  fixtureCanvas.value?.draw();
}

function handleWindowMouseUp() {
  spatialDragType = null;
  window.removeEventListener('mousemove', handleWindowMouseMove);
  window.removeEventListener('mouseup',   handleWindowMouseUp);
}

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
    class="viewport"
    :style="{ width: `${width}px`, height: `${height}px` }"
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
      :viewport-width="width"
      :viewport-height="height"
    />

    <!--
      Figma-style gradient handle — only visible when exactly 1 fixture is selected.
      Two handles:  ① origin (square-ish dot) — drag to reposition the effect center
                    ② endpoint (circle) — drag to change direction + magnitude
      Connected by a solid line (SVG).
    -->
    <template v-if="selectedFixture">
      <!-- SVG line connects origin to endpoint -->
      <svg class="gradient-svg" :width="width" :height="height">
        <line
          :x1="getOriginViewportPos(selectedFixture).x"
          :y1="getOriginViewportPos(selectedFixture).y"
          :x2="getEndViewportPos(selectedFixture).x"
          :y2="getEndViewportPos(selectedFixture).y"
          stroke="var(--primary)"
          style="opacity: 0.85"
          stroke-width="1.5"
        />
      </svg>

      <!-- ① Origin handle -->
      <SpatialHandle
        type="origin"
        :style="{
          left: `${getOriginViewportPos(selectedFixture).x}px`,
          top:  `${getOriginViewportPos(selectedFixture).y}px`,
        }"
        @dragstart="handleOriginDragStart($event)"
      />

      <!-- ② Endpoint handle -->
      <SpatialHandle
        type="endpoint"
        :style="{
          left: `${getEndViewportPos(selectedFixture).x}px`,
          top:  `${getEndViewportPos(selectedFixture).y}px`,
        }"
        @dragstart="handleEndpointDragStart($event)"
      />
    </template>

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
  outline: none; /* remove focus ring from tabindex */
}

.gradient-svg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
</style>

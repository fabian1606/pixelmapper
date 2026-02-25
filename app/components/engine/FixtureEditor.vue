<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import FixtureCanvas from './FixtureCanvas.vue';
import FixtureNode from './FixtureNode.vue';
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

const props = withDefaults(defineProps<Props>(), {
  width: 680,
  height: 420,
});

const FIXTURE_RADIUS = 18;
const DOT_SPACING    = 25;
const WORLD_WIDTH    = 3000;
const WORLD_HEIGHT   = 3000;

// ─── Composables ─────────────────────────────────────────────────────────────
const { camera, viewportToWorld, worldToViewport, onWheel } = useCamera();
const history = useHistory();

const { selectedIds, interaction, onViewportMouseDown, onDragStart, onMouseMove, onMouseUp } =
  useSelection(
    () => props.fixtures,
    () => WORLD_WIDTH,
    () => WORLD_HEIGHT,
    viewportToWorld,
    (before, after) => {
      history.execute(new MoveFixtureCommand(props.fixtures, before, after));
    },
  );

// ─── Viewport ref (for bounding rect) ────────────────────────────────────────
const viewportEl  = ref<HTMLElement | null>(null);
const fixtureCanvas = ref<InstanceType<typeof FixtureCanvas> | null>(null);

function rect(): DOMRect {
  return viewportEl.value!.getBoundingClientRect();
}

/**
 * Checks if a fixture is currently visible in the viewport.
 * Used for DOM culling (not rendering off-screen FixtureNodes).
 */
function isFixtureVisible(f: Fixture): boolean {
  const pos = worldToViewport(f.fixturePosition.x * WORLD_WIDTH, f.fixturePosition.y * WORLD_HEIGHT);
  const r   = (f.fixtureSize?.x ?? 1) * FIXTURE_RADIUS * camera.scale;
  const margin = r + 20;

  return (
    pos.x + margin >= 0 && pos.x - margin <= props.width &&
    pos.y + margin >= 0 && pos.y - margin <= props.height
  );
}

/**
 * Calculates the absolute viewport screen position for a fixture node.
 */
function getFixtureScreenPos(f: Fixture) {
  return worldToViewport(f.fixturePosition.x * WORLD_WIDTH, f.fixturePosition.y * WORLD_HEIGHT);
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
function handleKeyDown(e: KeyboardEvent) {
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return;

  if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); history.undo(); fixtureCanvas.value?.draw(); }
  if (e.key === 'z' &&  e.shiftKey) { e.preventDefault(); history.redo(); fixtureCanvas.value?.draw(); }
  if (e.key === 'y')                { e.preventDefault(); history.redo(); fixtureCanvas.value?.draw(); }
}

onMounted(() => {
  // Center camera on the world area (0-WORLD_WIDTH)
  camera.x = (props.width - WORLD_WIDTH * camera.scale) / 2;
  camera.y = (props.height - WORLD_HEIGHT * camera.scale) / 2;
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});

// ─── Event delegation ────────────────────────────────────────────────────────
function handleWheel(e: WheelEvent)      { onWheel(e, rect()); }
function handleMouseDown(e: MouseEvent)  { onViewportMouseDown(e, rect()); }
function handleDragStart(e: MouseEvent, f: Fixture) { onDragStart(e, f, rect()); }
function handleMouseMove(e: MouseEvent) {
  onMouseMove(e, rect());
  fixtureCanvas.value?.draw();
}
function handleMouseUp() {
  onMouseUp();
  fixtureCanvas.value?.draw();
}
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
    <!-- 
      Truly Infinite Canvas:
      We no longer have a giant 'world' div that we transform.
      Instead, the canvas is viewport-sized and handles its own transforms,
      and we position FixtureNodes directly in viewport space.
    -->

    <!-- Shared canvas: grid + glow + fill + marquee -->
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

    <!-- CSS interaction shells: Rendered directly in viewport space -->
    <template v-for="fixture in fixtures" :key="fixture.id">
      <FixtureNode
        v-if="isFixtureVisible(fixture)"
        :fixture="fixture"
        :radius="(fixture.fixtureSize?.x ?? 1) * FIXTURE_RADIUS * camera.scale"
        :is-selected="selectedIds.has(fixture.id)"
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
  background: #080810;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  overflow: hidden;
  cursor: crosshair;
  user-select: none;
}
</style>

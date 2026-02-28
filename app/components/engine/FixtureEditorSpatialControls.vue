<script setup lang="ts">
import { computed } from 'vue';
import type { Fixture } from '~/utils/engine/core/fixture';
import SpatialHandle from './SpatialHandle.vue';
import type { SpatialVector } from '~/utils/engine/types';

const props = defineProps<{
  viewportEl: HTMLElement | null;
  editorWidth: number;
  editorHeight: number;
  camera: { x: number; y: number; scale: number };
  selectedFixture: Fixture | null;
  worldWidth: number;
  worldHeight: number;
  worldToViewport: (wx: number, wy: number) => { x: number; y: number };
}>();

const emit = defineEmits<{
  (e: 'spatialChange', fixture: Fixture, vector: SpatialVector): void;
  (e: 'redraw'): void;
}>();

// ─── Gradient handle viewport positions ───────────────────────────────────────
function getOriginViewportPos(f: Fixture) {
  const cfg = f.spatialConfig;
  return props.worldToViewport(cfg.originX * props.worldWidth, cfg.originY * props.worldHeight);
}

function getEndViewportPos(f: Fixture) {
  const cfg = f.spatialConfig;
  const ex = cfg.originX * props.worldWidth  + Math.cos(cfg.angle) * cfg.magnitude * props.worldWidth;
  const ey = cfg.originY * props.worldHeight + Math.sin(cfg.angle) * cfg.magnitude * props.worldWidth;
  return props.worldToViewport(ex, ey);
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
  const f = props.selectedFixture;
  if (!f || !spatialDragType) return;

  const r = props.viewportEl?.getBoundingClientRect();
  if (!r) return;

  const vx = e.clientX - r.left;
  const vy = e.clientY - r.top;
  const wx = (vx - props.camera.x) / props.camera.scale;
  const wy = (vy - props.camera.y) / props.camera.scale;
  const cfg = f.spatialConfig;

  if (spatialDragType === 'origin') {
    cfg.originX = wx / props.worldWidth;
    cfg.originY = wy / props.worldHeight;
  } else if (spatialDragType === 'endpoint') {
    const ox = cfg.originX * props.worldWidth;
    const oy = cfg.originY * props.worldHeight;
    const dx = wx - ox;
    const dy = wy - oy;
    cfg.angle     = Math.atan2(dy, dx);
    cfg.magnitude = Math.sqrt(dx * dx + dy * dy) / props.worldWidth;
  }

  emit('spatialChange', f, { ...cfg });
  emit('redraw');
}

function handleWindowMouseUp() {
  spatialDragType = null;
  window.removeEventListener('mousemove', handleWindowMouseMove);
  window.removeEventListener('mouseup',   handleWindowMouseUp);
}
</script>

<template>
  <template v-if="selectedFixture">
    <!-- SVG line connects origin to endpoint -->
    <svg class="gradient-svg" :width="editorWidth" :height="editorHeight">
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
</template>

<style scoped>
.gradient-svg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
</style>

<script setup lang="ts">
import { computed } from 'vue';
import type { Effect, SpatialVector } from '~/utils/engine/types';
import SpatialHandle from './SpatialHandle.vue';

const props = defineProps<{
  viewportEl: HTMLElement | null;
  editorWidth: number;
  editorHeight: number;
  camera: { x: number; y: number; scale: number };
  activeModifier: Effect | null | undefined;
  worldWidth: number;
  worldHeight: number;
  worldToViewport: (wx: number, wy: number) => { x: number; y: number };
}>();

const emit = defineEmits<{
  (e: 'modifierChange', modifier: Effect, changes: Partial<Effect>): void;
  (e: 'modifierDragEnd', modifier: Effect): void;
  (e: 'redraw'): void;
}>();

// ─── Gradient handle viewport positions ───────────────────────────────────────
function getOriginViewportPos(m: Effect) {
  const ox = m.originX ?? 0.5;
  const oy = m.originY ?? 0.5;
  return props.worldToViewport(ox * props.worldWidth, oy * props.worldHeight);
}

function getEndViewportPos(m: Effect) {
  const ox = m.originX ?? 0.5;
  const oy = m.originY ?? 0.5;
  const angle = m.angle ?? 0;
  // fanning = one full wavelength = world-space distance from origin to endpoint
  const magnitude = m.fanning ?? 0.1;
  const ex = ox * props.worldWidth  + Math.cos(angle) * magnitude * props.worldWidth;
  const ey = oy * props.worldHeight + Math.sin(angle) * magnitude * props.worldWidth;
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
  const m = props.activeModifier;
  if (!m || !spatialDragType) return;

  const r = props.viewportEl?.getBoundingClientRect();
  if (!r) return;

  const vx = e.clientX - r.left;
  const vy = e.clientY - r.top;
  const wx = (vx - props.camera.x) / props.camera.scale;
  const wy = (vy - props.camera.y) / props.camera.scale;

  if (spatialDragType === 'origin') {
    // Directly mutate the reactive effect object (it lives in effectEngine.effects which is reactive)
    m.originX = wx / props.worldWidth;
    m.originY = wy / props.worldHeight;
  } else if (spatialDragType === 'endpoint') {
    const ox = (m.originX ?? 0.5) * props.worldWidth;
    const oy = (m.originY ?? 0.5) * props.worldHeight;
    const dx = wx - ox;
    const dy = wy - oy;
    m.angle = Math.atan2(dy, dx);
    // fanning = one wavelength = raw normalized distance from origin to endpoint
    m.fanning = Math.max(0.001, Math.sqrt(dx * dx + dy * dy) / props.worldWidth);
  }

  emit('redraw');
}

function handleWindowMouseUp() {
  spatialDragType = null;
  window.removeEventListener('mousemove', handleWindowMouseMove);
  window.removeEventListener('mouseup',   handleWindowMouseUp);
  if (props.activeModifier) {
    emit('modifierDragEnd', props.activeModifier);
  }
}
</script>

<template>
  <template v-if="activeModifier">
    <!-- SVG line connects origin to endpoint -->
    <svg class="gradient-svg" :width="editorWidth" :height="editorHeight">
      <line
        :x1="getOriginViewportPos(activeModifier).x"
        :y1="getOriginViewportPos(activeModifier).y"
        :x2="getEndViewportPos(activeModifier).x"
        :y2="getEndViewportPos(activeModifier).y"
        stroke="var(--primary)"
        style="opacity: 0.85"
        stroke-width="1.5"
      />
    </svg>

    <!-- ① Origin handle -->
    <SpatialHandle
      type="origin"
      :style="{
        left: `${getOriginViewportPos(activeModifier).x}px`,
        top:  `${getOriginViewportPos(activeModifier).y}px`,
      }"
      @dragstart="handleOriginDragStart($event)"
    />

    <!-- ② Endpoint handle -->
    <SpatialHandle
      type="endpoint"
      :style="{
        left: `${getEndViewportPos(activeModifier).x}px`,
        top:  `${getEndViewportPos(activeModifier).y}px`,
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

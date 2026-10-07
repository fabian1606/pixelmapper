<script setup lang="ts">
import { computed } from 'vue';
import type { ModifierInstance } from '~/utils/engine/types';
import SpatialHandle from './SpatialHandle.vue';
import { useLiveBusStore } from '~/stores/live-bus-store';

const liveBus = useLiveBusStore();

const props = defineProps<{
  viewportEl: HTMLElement | null;
  editorWidth: number;
  editorHeight: number;
  camera: { x: number; y: number; scale: number };
  activeModifier: ModifierInstance | null | undefined;
  worldWidth: number;
  worldHeight: number;
  worldToViewport: (wx: number, wy: number) => { x: number; y: number };
}>();

const emit = defineEmits<{
  (e: 'modifierChange', modifier: ModifierInstance, changes: Partial<ModifierInstance>): void;
  (e: 'modifierDragEnd', modifier: ModifierInstance): void;
  (e: 'dragStart', type: 'origin' | 'endpoint'): void;
  (e: 'redraw'): void;
}>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Point-valued param shape. */
type Point = { x: number; y: number };

/**
 * True when the plugin owns its spatial layout through an `origin` point
 * param (plus `angle`/`scale`, e.g. the sequencer). The handles then edit
 * those params instead of the host's phase-distribution fields.
 */
function hasSpatialParams(m: ModifierInstance): boolean {
  const o = m.params?.origin as Point | undefined;
  return !!o && typeof o === 'object' && 'x' in o;
}

/** Origin, angle and handle length in normalized world units. */
function spatialOf(m: ModifierInstance): { ox: number; oy: number; angle: number; magnitude: number } {
  if (hasSpatialParams(m)) {
    const o = m.params.origin as Point;
    return { ox: o.x, oy: o.y, angle: Number(m.params.angle ?? 0), magnitude: Number(m.params.scale ?? 0.1) };
  }
  return { ox: m.originX ?? 0.5, oy: m.originY ?? 0.5, angle: m.angle ?? 0, magnitude: m.fanning ?? 0.1 };
}

// ─── Gradient handle viewport positions ───────────────────────────────────────
function getOriginViewportPos(m: ModifierInstance) {
  const { ox, oy } = spatialOf(m);
  return props.worldToViewport(ox * props.worldWidth, oy * props.worldHeight);
}

function getEndViewportPos(m: ModifierInstance) {
  const { ox, oy, angle, magnitude } = spatialOf(m);
  const ex = ox * props.worldWidth  + Math.cos(angle) * magnitude * props.worldWidth;
  const ey = oy * props.worldHeight + Math.sin(angle) * magnitude * props.worldWidth;
  return props.worldToViewport(ex, ey);
}

// ─── Gradient handle drag (window-global for reliable capture) ─────────────────
type HandleDragType = 'origin' | 'endpoint' | null;
let spatialDragType: HandleDragType = null;

function handleOriginDragStart(e: MouseEvent) {
  spatialDragType = 'origin';
  emit('dragStart', 'origin');
  window.addEventListener('mousemove', handleWindowMouseMove);
  window.addEventListener('mouseup',   handleWindowMouseUp);
}

function handleEndpointDragStart(e: MouseEvent) {
  spatialDragType = 'endpoint';
  emit('dragStart', 'endpoint');
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

  const { ox, oy } = spatialOf(m);
  const dx = wx - ox * props.worldWidth;
  const dy = wy - oy * props.worldHeight;

  if (hasSpatialParams(m)) {
    // Plugin-owned spatial params (origin point, angle, scale).
    const paramChanges: Record<string, unknown> = spatialDragType === 'origin'
      ? { origin: { x: wx / props.worldWidth, y: wy / props.worldHeight } }
      : { angle: Math.atan2(dy, dx), scale: Math.max(0.001, Math.sqrt(dx * dx + dy * dy) / props.worldWidth) };
    emit('modifierChange', m, { params: { ...m.params, ...paramChanges } as ModifierInstance['params'] });
    liveBus.dispatch('modifier.update', { effectId: m.id, changes: {}, paramChanges });
  } else {
    // Host phase distribution; fanning = one wavelength = distance origin → endpoint.
    const changes: Partial<ModifierInstance> = spatialDragType === 'origin'
      ? { originX: wx / props.worldWidth, originY: wy / props.worldHeight }
      : { angle: Math.atan2(dy, dx), fanning: Math.max(0.001, Math.sqrt(dx * dx + dy * dy) / props.worldWidth) };
    emit('modifierChange', m, changes);
    liveBus.dispatch('modifier.update', { effectId: m.id, changes });
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
      :x="getOriginViewportPos(activeModifier).x"
      :y="getOriginViewportPos(activeModifier).y"
      @dragstart="handleOriginDragStart($event)"
    />

    <!-- ② Endpoint handle -->
    <SpatialHandle
      type="endpoint"
      :x="getEndViewportPos(activeModifier).x"
      :y="getEndViewportPos(activeModifier).y"
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

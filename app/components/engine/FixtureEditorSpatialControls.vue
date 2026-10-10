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

/** Origin and end of the handle in normalized world units. */
function handleOf(m: ModifierInstance): { origin: Point; end: Point } {
  if (hasSpatialParams(m)) {
    const o = m.params.origin as Point;
    const angle = Number(m.params.angle ?? 0);
    const scale = Number(m.params.scale ?? 0.1);
    return { origin: o, end: { x: o.x + Math.cos(angle) * scale, y: o.y + Math.sin(angle) * scale * props.worldWidth / props.worldHeight } };
  }
  return { origin: m.distribution.origin, end: m.distribution.end };
}

// ─── Gradient handle viewport positions ───────────────────────────────────────
function getOriginViewportPos(m: ModifierInstance) {
  const { origin } = handleOf(m);
  return props.worldToViewport(origin.x * props.worldWidth, origin.y * props.worldHeight);
}

function getEndViewportPos(m: ModifierInstance) {
  const { end } = handleOf(m);
  return props.worldToViewport(end.x * props.worldWidth, end.y * props.worldHeight);
}

/** Mode guide: radial circle (radius |end − origin|) or conical ray. */
const guide = computed(() => {
  const m = props.activeModifier;
  if (!m || hasSpatialParams(m)) return null;
  const { origin, end } = handleOf(m);
  const c = props.worldToViewport(origin.x * props.worldWidth, origin.y * props.worldHeight);
  const e = props.worldToViewport(end.x * props.worldWidth, end.y * props.worldHeight);
  const len = Math.hypot(end.x - origin.x, end.y - origin.y);
  const scale = props.camera.scale;
  if (m.distribution.mode === 'radial') {
    return { kind: 'radial' as const, cx: c.x, cy: c.y, rx: len * props.worldWidth * scale, ry: len * props.worldHeight * scale };
  }
  if (m.distribution.mode === 'conical') {
    const k = 4;
    return { kind: 'conical' as const, cx: c.x, cy: c.y, x2: c.x + (e.x - c.x) * k, y2: c.y + (e.y - c.y) * k };
  }
  return null;
});

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

  const { origin } = handleOf(m);
  const dx = wx - origin.x * props.worldWidth;
  const dy = wy - origin.y * props.worldHeight;

  if (hasSpatialParams(m)) {
    // Plugin-owned spatial params (origin point, angle, scale).
    const paramChanges: Record<string, unknown> = spatialDragType === 'origin'
      ? { origin: { x: wx / props.worldWidth, y: wy / props.worldHeight } }
      : { angle: Math.atan2(dy, dx), scale: Math.max(0.001, Math.sqrt(dx * dx + dy * dy) / props.worldWidth) };
    emit('modifierChange', m, { params: { ...m.params, ...paramChanges } as ModifierInstance['params'] });
    liveBus.dispatch('modifier.update', { effectId: m.id, changes: {}, paramChanges });
  } else {
    // Distribution gradient handle: origin moves the whole handle, end sets direction and length.
    const p = { x: wx / props.worldWidth, y: wy / props.worldHeight };
    const d = m.distribution;
    const distribution = spatialDragType === 'origin'
      ? { ...d, origin: p, end: { x: d.end.x + p.x - d.origin.x, y: d.end.y + p.y - d.origin.y } }
      : { ...d, end: p };
    const changes: Partial<ModifierInstance> = { distribution };
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
      <!-- Radial: the circle where spatial = 1 (normalized space → ellipse in world px) -->
      <ellipse
        v-if="guide?.kind === 'radial'"
        :cx="guide.cx" :cy="guide.cy" :rx="guide.rx" :ry="guide.ry"
        fill="none" stroke="var(--primary)" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="4 4"
        data-guide="radial"
      />
      <!-- Conical: the ray where the sweep starts -->
      <line
        v-if="guide?.kind === 'conical'"
        :x1="guide.cx" :y1="guide.cy" :x2="guide.x2" :y2="guide.y2"
        stroke="var(--primary)" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="4 4"
        data-guide="conical"
      />
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

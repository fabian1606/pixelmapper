<script setup lang="ts">
/**
 * Canvas handles of the active modifier's hinted params (plan M4 "Canvas
 * hints"): one dot per `ui.canvas: 'point'` param, one ring per
 * `ui.canvas: 'radius'` param around its anchor point. Independent of the
 * distribution mode; coexists with the distribution origin/end handle.
 *
 * Drag: live params via `modifierChange` + `liveBus` `modifier.update`; the
 * parent commits one `SetModifiersCommand` on `modifierDragEnd` (mouse-up).
 * Points snap to the world edges/center and to the other points (hold Alt
 * to drag freely) and are clamped to 0–1; radii are clamped to [min, max].
 */
import { computed } from 'vue';
import type { Vec2 } from '@pixelmapper/extension-api';
import { useLiveBusStore } from '~/stores/live-bus-store';
import type { ModifierInstance } from '~/utils/engine/types';
import { getManifest } from '~/utils/plugins/plugin-store';
import SpatialHandle from '../SpatialHandle.vue';
import {
  collectCanvasHandles,
  pointFromPointer,
  radiusFromPointer,
  snapTargets,
  type CanvasHandle,
} from './canvas-hint-geometry';

const props = defineProps<{
  viewportEl: HTMLElement | null;
  editorWidth: number;
  editorHeight: number;
  camera: { x: number; y: number; scale: number };
  activeModifier: ModifierInstance;
  worldWidth: number;
  worldHeight: number;
  worldToViewport: (wx: number, wy: number) => { x: number; y: number };
}>();

const emit = defineEmits<{
  (e: 'modifierChange', modifier: ModifierInstance, changes: Partial<ModifierInstance>): void;
  (e: 'modifierDragEnd', modifier: ModifierInstance, description: string): void;
  (e: 'dragStart'): void;
  (e: 'redraw'): void;
}>();

const liveBus = useLiveBusStore();

/** Screen distance (px) within which a dragged point snaps. */
const SNAP_PX = 6;

// ── Handles in viewport space ────────────────────────────────────────────────

/** Hinted handles of the active modifier (empty without a manifest). */
const handles = computed<CanvasHandle[]>(() => {
  const m = props.activeModifier;
  const manifest = getManifest(m.plugin);
  if (!manifest) return [];
  return collectCanvasHandles(manifest.params, m.params ?? {}, m.distribution?.mode);
});

/** Normalized world point → viewport px. */
function toViewport(p: Vec2) {
  return props.worldToViewport(p.x * props.worldWidth, p.y * props.worldHeight);
}

/** Render model: dots and rings with viewport positions. */
const view = computed(() => {
  void props.camera.x; void props.camera.y; void props.camera.scale;
  return handles.value.map((h) => {
    if (h.kind === 'point') return { h, pos: toViewport(h.value) };
    const c = toViewport(h.center);
    // Radius in world-x units → a circle of r × worldWidth world px.
    const r = h.radius * props.worldWidth * props.camera.scale;
    return { h, pos: c, r, knob: { x: c.x + r, y: c.y } };
  });
});

// ── Drag (window-global for reliable capture) ────────────────────────────────

/** Handle being dragged. */
let dragging: CanvasHandle | null = null;

/** Starts dragging handle `h`. */
function startDrag(h: CanvasHandle) {
  dragging = h;
  emit('dragStart');
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

/** Pointer → normalized world point. */
function pointerToWorld(e: MouseEvent): Vec2 | null {
  const r = props.viewportEl?.getBoundingClientRect();
  if (!r) return null;
  const wx = (e.clientX - r.left - props.camera.x) / props.camera.scale;
  const wy = (e.clientY - r.top - props.camera.y) / props.camera.scale;
  return { x: wx / props.worldWidth, y: wy / props.worldHeight };
}

/** Applies a live param change (local instance + live bus). */
function applyParams(paramChanges: Record<string, unknown>) {
  const m = props.activeModifier;
  emit('modifierChange', m, { params: { ...m.params, ...paramChanges } as ModifierInstance['params'] });
  liveBus.dispatch('modifier.update', { effectId: m.id, changes: {}, paramChanges });
  emit('redraw');
}

function onMove(e: MouseEvent) {
  const h = dragging;
  const p = h && pointerToWorld(e);
  if (!h || !p) return;
  if (h.kind === 'point') {
    const scale = props.camera.scale;
    const snap = e.altKey ? undefined : {
      ...snapTargets(handles.value, h.key),
      tolX: SNAP_PX / (props.worldWidth * scale),
      tolY: SNAP_PX / (props.worldHeight * scale),
    };
    applyParams({ [h.key]: pointFromPointer(p, snap) });
  } else {
    // Read the anchor live: it may have moved since the drag started.
    const live = handles.value.find(x => x.kind === 'radius' && x.key === h.key);
    const center = live?.kind === 'radius' ? live.center : h.center;
    applyParams({ [h.key]: radiusFromPointer(center, p, props.worldWidth / props.worldHeight, h.min, h.max) });
  }
}

function onUp() {
  const h = dragging;
  dragging = null;
  window.removeEventListener('mousemove', onMove);
  window.removeEventListener('mouseup', onUp);
  if (h) emit('modifierDragEnd', props.activeModifier, `Move ${h.label}`);
}
</script>

<template>
  <svg class="canvas-hints-svg" :width="editorWidth" :height="editorHeight">
    <template v-for="v in view" :key="`ring-${v.h.key}`">
      <g v-if="v.h.kind === 'radius'" :data-canvas-ring="v.h.key">
        <!-- Visible ring (true circle: radius is in world-x units) -->
        <circle
          :cx="v.pos.x" :cy="v.pos.y" :r="v.r"
          fill="none" :stroke="v.h.color ?? 'var(--primary)'" stroke-opacity="0.8" stroke-width="1.5" stroke-dasharray="5 4"
        />
        <!-- Wide invisible stroke: grab the ring anywhere -->
        <circle
          class="canvas-hints-ring-hit"
          :cx="v.pos.x" :cy="v.pos.y" :r="v.r"
          fill="none" stroke="transparent" stroke-width="10"
          @mousedown.prevent.stop="startDrag(v.h)"
        />
      </g>
    </template>
  </svg>

  <template v-for="v in view" :key="v.h.key">
    <template v-if="v.h.kind === 'radius'">
      <SpatialHandle type="knob" :x="v.knob!.x" :y="v.knob!.y" :color="v.h.color" :data-canvas-handle="v.h.key" @dragstart="startDrag(v.h)" />
      <div class="canvas-hints-label" :style="{ transform: `translate3d(${v.knob!.x + 8}px, ${v.knob!.y - 18}px, 0)` }">{{ v.h.label }}</div>
    </template>
    <template v-else>
      <SpatialHandle type="point" :x="v.pos.x" :y="v.pos.y" :color="v.h.color" :data-canvas-handle="v.h.key" @dragstart="startDrag(v.h)" />
      <div class="canvas-hints-label" :style="{ transform: `translate3d(${v.pos.x + 10}px, ${v.pos.y - 20}px, 0)` }">{{ v.h.label }}</div>
    </template>
  </template>
</template>

<style scoped>
.canvas-hints-svg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.canvas-hints-ring-hit {
  pointer-events: stroke;
  cursor: ew-resize;
}

.canvas-hints-label {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 19;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  line-height: 14px;
  white-space: nowrap;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  pointer-events: none;
}
</style>

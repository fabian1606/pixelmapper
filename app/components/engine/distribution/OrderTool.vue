<script setup lang="ts">
/**
 * Order tools on the canvas (plan M4.3), active while the Distribution
 * section's tool is on:
 * - **Click**: a click on a targeted fixture assigns the next rank, Shift
 *   the same rank as the previous click; clicking a ranked fixture moves it.
 *   Each click is live; the editor commits the session once when the tool
 *   ends (Esc, the tool button, or another modifier).
 * - **Line**: press–drag–release draws a line (dashed, with an arrow); on
 *   release the order follows the projection on it (one undo step).
 * The root carries `data-overlay-root`, so the properties sidebar stays open.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { Distribution, Vec2 } from '@pixelmapper/extension-api';
import type { ModifierInstance } from '~/utils/engine/types';
import { clickRank } from '~/utils/engine/distribution/order';
import type { DistributionTool } from '~/stores/distribution-tool-store';

const props = defineProps<{
  tool: DistributionTool;
  modifier: ModifierInstance;
  worldWidth: number;
  worldHeight: number;
  /** Viewport px → world px. */
  viewportToWorld: (vx: number, vy: number) => { x: number; y: number };
  /** Fixture id under a viewport point (canvas hit test). */
  hitTest: (vx: number, vy: number) => string | null | undefined;
}>();

const emit = defineEmits<{
  /** Live distribution change. */
  change: [distribution: Distribution];
  /** Commit the changes since the last commit as one undo step. */
  commit: [description: string];
  /** End the tool (Esc). */
  done: [];
}>();

const rootRef = ref<HTMLElement | null>(null);
/** Rank of the last click (null before the first click of the session). */
let last: number | null = null;
/** Line being drawn (viewport px) and its world endpoints. */
const draft = ref<{ a: Vec2; b: Vec2; wa: Vec2; wb: Vec2 } | null>(null);

/** True when the instance targets the fixture. */
function targets(id: string): boolean {
  const ids = props.modifier.targetFixtureIds;
  return !ids || ids.some(t => String(t) === id);
}

/** Viewport point of a pointer event. */
function local(e: PointerEvent): Vec2 {
  const r = rootRef.value!.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/** Normalized world position of a viewport point. */
function world(p: Vec2): Vec2 {
  const w = props.viewportToWorld(p.x, p.y);
  return { x: w.x / props.worldWidth, y: w.y / props.worldHeight };
}

function onDown(e: PointerEvent) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const p = local(e);
  if (props.tool === 'click') {
    const id = props.hitTest(p.x, p.y);
    if (!id || !targets(id)) return;
    const d = props.modifier.distribution;
    // The first click of a session starts a fresh order.
    const res = clickRank(last === null ? {} : d.order.ranks, id, e.shiftKey, last);
    last = res.last;
    emit('change', { ...d, order: { ...d.order, ranks: res.ranks } });
    return;
  }
  const w = world(p);
  draft.value = { a: p, b: p, wa: w, wb: w };
  rootRef.value?.setPointerCapture?.(e.pointerId);
}

function onMove(e: PointerEvent) {
  if (!draft.value) return;
  const p = local(e);
  draft.value = { ...draft.value, b: p, wb: world(p) };
}

function onUp() {
  const l = draft.value;
  draft.value = null;
  if (!l || Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y) < 6) return;
  const d = props.modifier.distribution;
  // Ranks resolve from the stored line (Snap re-resolves live; new fixtures place themselves).
  emit('change', { ...d, order: { ...d.order, ranks: {}, line: { a: l.wa, b: l.wb } } });
  emit('commit', 'Draw Order Line');
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('done');
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div
    ref="rootRef"
    class="absolute inset-0 z-10 cursor-crosshair"
    data-overlay-root
    data-order-tool
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @mousedown.stop
  >
    <svg v-if="draft" class="absolute inset-0 w-full h-full pointer-events-none">
      <defs>
        <marker id="order-line-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L8 4 L0 8 Z" fill="var(--primary)" />
        </marker>
      </defs>
      <line :x1="draft.a.x" :y1="draft.a.y" :x2="draft.b.x" :y2="draft.b.y" stroke="var(--primary)" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#order-line-arrow)" />
    </svg>
    <div class="absolute left-1/2 top-2 -translate-x-1/2 rounded-md bg-popover/90 px-2 py-1 text-[11px] text-muted-foreground shadow pointer-events-none">
      {{ tool === 'click' ? 'Click fixtures in order · Shift-click = same step · Esc to finish' : 'Drag a line through the rig · Esc to finish' }}
    </div>
  </div>
</template>

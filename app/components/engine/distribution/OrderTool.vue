<script setup lang="ts">
/**
 * Reassign session on the canvas (plan M4.3, revision R1). One mode:
 * - **click** a targeted fixture → next number (Shift: same number as the
 *   previous click; clicking a numbered fixture moves it). Numbers of the
 *   session show as they are given; the session ends when every targeted
 *   fixture has a number, on Esc, or via the Reassign button.
 * - **drag** a line → the order follows the projection on it (roughly
 *   symmetric fixtures share a number; a line starting inside the rig
 *   orders outward on both sides) and the session ends.
 * The editor commits the session as one undo step when it ends. The root
 * carries `data-overlay-root`, so the properties sidebar stays open.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Distribution, Vec2 } from '@pixelmapper/extension-api';
import type { Fixture } from '~/utils/engine/core/fixture';
import type { ModifierInstance } from '~/utils/engine/types';
import { clickRank, lineStartsInside } from '~/utils/engine/distribution/order';

const props = defineProps<{
  modifier: ModifierInstance;
  /** Fixtures on the canvas (targeted ones are numbered). */
  fixtures: Fixture[];
  worldWidth: number;
  worldHeight: number;
  /** Viewport px → world px and back. */
  viewportToWorld: (vx: number, vy: number) => { x: number; y: number };
  worldToViewport: (wx: number, wy: number) => { x: number; y: number };
  /** Fixture id under a viewport point (canvas hit test). */
  hitTest: (vx: number, vy: number) => string | null | undefined;
}>();

const emit = defineEmits<{
  /** Live distribution change. */
  change: [distribution: Distribution];
  /** End the session (the editor commits it). */
  done: [];
}>();

/** Drag distance (px) that turns a press into a line. */
const LINE_THRESHOLD = 6;

const rootRef = ref<HTMLElement | null>(null);
/** Numbers given in this session (fixture id → rank). */
const given = ref<Record<string, number>>({});
let last: number | null = null;
/** Current press: start point, fixture under it, and the line being drawn. */
let press: { start: Vec2; hit: string | null } | null = null;
const draft = ref<{ a: Vec2; b: Vec2 } | null>(null);

const targeted = computed(() => {
  const ids = props.modifier.targetFixtureIds?.map(String);
  return props.fixtures.filter(f => !ids || ids.includes(String(f.id)));
});

/** Badges of the session's numbers. */
const badges = computed(() => targeted.value.flatMap((f) => {
  const r = given.value[String(f.id)];
  if (r === undefined) return [];
  const p = props.worldToViewport(f.fixturePosition.x * props.worldWidth, f.fixturePosition.y * props.worldHeight);
  return [{ id: String(f.id), x: p.x, y: p.y, label: String(r + 1) }];
}));

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
  const start = local(e);
  const hit = props.hitTest(start.x, start.y) ?? null;
  press = { start, hit: hit && targeted.value.some(f => String(f.id) === hit) ? hit : null };
  rootRef.value?.setPointerCapture?.(e.pointerId);
}

function onMove(e: PointerEvent) {
  if (!press) return;
  const p = local(e);
  if (draft.value || Math.hypot(p.x - press.start.x, p.y - press.start.y) >= LINE_THRESHOLD) draft.value = { a: press.start, b: p };
}

function onUp(e: PointerEvent) {
  const pr = press;
  press = null;
  const line = draft.value;
  draft.value = null;
  if (!pr) return;
  const d = props.modifier.distribution;
  if (line) {
    const a = world(line.a);
    const b = world(line.b);
    const pts = targeted.value.map(f => ({ id: f.id, x: f.fixturePosition.x, y: f.fixturePosition.y }));
    emit('change', { ...d, order: { ...d.order, ranks: {}, line: { a, b }, mirror: lineStartsInside(pts, a, b) } });
    emit('done');
    return;
  }
  if (!pr.hit) return;
  const res = clickRank(given.value, pr.hit, e.shiftKey, last);
  last = res.last;
  given.value = res.ranks;
  emit('change', { ...d, order: { ...d.order, ranks: { ...res.ranks } } });
  if (targeted.value.every(f => given.value[String(f.id)] !== undefined)) emit('done');
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
    <div
      v-for="b in badges" :key="b.id"
      class="absolute -translate-x-1/2 -translate-y-1/2 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-semibold leading-4 text-center text-white shadow ring-1 ring-black/40 pointer-events-none"
      :style="{ left: `${b.x}px`, top: `${b.y - 14}px`, background: 'var(--primary)' }"
      :data-session-badge="b.id"
    >
      {{ b.label }}
    </div>
    <div class="absolute left-1/2 top-2 -translate-x-1/2 max-w-[90%] truncate rounded-md bg-popover/90 px-2 py-1 text-[11px] text-muted-foreground shadow pointer-events-none">
      Click fixtures in order · Shift-click = same step · or draw a line · Esc to finish
    </div>
  </div>
</template>

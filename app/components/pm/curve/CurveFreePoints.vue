<script setup lang="ts">
/**
 * Free-point editing of `pm.curve` (plan M2.5), as an overlay over the
 * editor: drag points (end points: y only), click near the curve to insert,
 * Del/Backspace or double-click removes the selected inner point, right-click
 * opens the segment-kind menu, the selected point shows tangent handles
 * (Alt-drag decouples), Shift snaps to ticks and the 25 % grid.
 */
import { computed, ref } from 'vue';
import type { CurvePointKind, CurvePointV2 } from '@pixelmapper/extension-api';
import { domainT, evaluatePoints } from '~/utils/params/curve-shapes';
import type { CurveDomain } from '@pixelmapper/extension-api';
import { ACCENT, SVG_H, pointerToEditor, snapToTicks, svgY } from './curve-geometry';
import { dragTangent, handlesOf, insertPoint, movePoint, removePoint, setKind } from './use-free-points';

const props = defineProps<{
  points: CurvePointV2[];
  domain: CurveDomain;
  /** Tick positions in domain units (Shift snapping). */
  ticks: number[];
  getRect: () => DOMRect | undefined;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  update: [points: CurvePointV2[]];
  scrubStart: [];
  scrubEnd: [];
}>();

const KINDS: { kind: CurvePointKind; label: string }[] = [
  { kind: 'smooth', label: 'Smooth' }, { kind: 'corner', label: 'Corner' }, { kind: 'linear', label: 'Linear' }, { kind: 'step', label: 'Step' },
];

const selected = ref<number | null>(null);
const menu = ref<{ index: number; left: string; top: string } | null>(null);

/** Percent position of a normalized point. */
const pos = (x: number, y: number) => ({ left: `${x * 100}%`, top: `${(svgY(y) / SVG_H) * 100}%` });

/** Tick positions in normalized point space. */
const tickT = computed(() => props.ticks.map(t => domainT(props.domain, t)));

/** Pointer → normalized point space (optionally snapped). */
function pointer(e: PointerEvent | MouseEvent): { x: number; y: number } | null {
  const rect = props.getRect();
  if (!rect) return null;
  const p = pointerToEditor(e, rect, props.domain);
  const t = domainT(props.domain, p.x);
  if (!e.shiftKey) return { x: t, y: p.y };
  return { x: snapToTicks(t, tickT.value), y: Math.round(p.y * 4) / 4 };
}

/** Runs a drag: `apply` maps each pointer position to new points (one scrub). */
function drag(e: PointerEvent, apply: (p: { x: number; y: number }, me: PointerEvent) => CurvePointV2[]) {
  if (props.disabled || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  emit('scrubStart');
  const move = (me: PointerEvent) => {
    const p = pointer(me);
    if (p) emit('update', apply(p, me));
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    emit('scrubEnd');
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/** Emits one discrete edit as its own undo step. */
function commit(points: CurvePointV2[]) {
  emit('scrubStart');
  emit('update', points);
  emit('scrubEnd');
}

function onPointDown(e: PointerEvent, i: number) {
  selected.value = i;
  menu.value = null;
  drag(e, p => movePoint(props.points, i, p.x, p.y));
}

function onTangentDown(e: PointerEvent, i: number, side: 'in' | 'out') {
  const base = props.points[i]!;
  drag(e, (p, me) => dragTangent(props.points, i, side, { dx: p.x - base.x, dy: p.y - base.y }, me.altKey));
}

/** Click near the curve inserts a point; elsewhere it deselects. */
function onBackground(e: MouseEvent) {
  menu.value = null;
  const p = pointer(e);
  if (!p || props.disabled) return;
  if (Math.abs(evaluatePoints(props.points, p.x) - p.y) > 0.1) {
    selected.value = null;
    return;
  }
  const res = insertPoint(props.points, p.x);
  if (res.index < 0) return;
  selected.value = res.index;
  commit(res.points);
}

function remove(i: number) {
  if (i <= 0 || i >= props.points.length - 1 || props.disabled) return;
  selected.value = null;
  commit(removePoint(props.points, i));
}

function onKey(e: KeyboardEvent) {
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected.value !== null) {
    e.preventDefault();
    remove(selected.value);
  }
}

function openMenu(e: MouseEvent, i: number) {
  if (props.disabled) return;
  selected.value = i;
  menu.value = { index: i, ...pos(props.points[i]!.x, props.points[i]!.y) };
}

function chooseKind(kind: CurvePointKind) {
  if (!menu.value) return;
  commit(setKind(props.points, menu.value.index, kind));
  menu.value = null;
}

/** Tangent handles of the selected point (smooth/corner only). */
const tangents = computed(() => {
  const i = selected.value;
  if (i === null || i >= props.points.length) return [];
  const p = props.points[i]!;
  if (p.kind === 'linear' || p.kind === 'step') return [];
  const h = handlesOf(props.points, i);
  return (['in', 'out'] as const).flatMap(side => (h[side] ? [{ side, ...pos(p.x + h[side]!.dx, p.y + h[side]!.dy), from: pos(p.x, p.y) }] : []));
});
</script>

<template>
  <div class="absolute inset-0 outline-none" tabindex="0" aria-label="Curve points" @click="onBackground" @keydown="onKey">
    <!-- Tangent lines -->
    <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <line
        v-for="t in tangents" :key="`l${t.side}`"
        :x1="parseFloat(t.from.left)" :y1="parseFloat(t.from.top)" :x2="parseFloat(t.left)" :y2="parseFloat(t.top)"
        :stroke="ACCENT" stroke-opacity="0.6" stroke-width="1" vector-effect="non-scaling-stroke"
      />
    </svg>
    <div
      v-for="t in tangents" :key="t.side"
      class="absolute w-2 h-2 -translate-x-1/2 -translate-y-1/2 cursor-move border border-black/60"
      :style="{ left: t.left, top: t.top, background: ACCENT }"
      :data-tangent="t.side"
      @pointerdown="e => onTangentDown(e, selected!, t.side)"
      @click.stop
    />
    <!-- Points -->
    <div
      v-for="(p, i) in points" :key="i"
      class="absolute w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] cursor-grab"
      :style="{ ...pos(p.x, p.y), borderColor: ACCENT, background: selected === i ? ACCENT : 'var(--background)' }"
      :data-point="i"
      :title="p.kind === 'step' ? 'Step' : p.kind === 'linear' ? 'Linear' : p.kind === 'corner' ? 'Corner' : 'Smooth'"
      @pointerdown="e => onPointDown(e, i)"
      @dblclick.stop="remove(i)"
      @contextmenu.prevent.stop="e => openMenu(e, i)"
      @click.stop
    />
    <!-- Segment kind menu -->
    <div
      v-if="menu"
      class="absolute z-10 mt-2 -translate-x-1/2 flex gap-0.5 rounded-md border border-border bg-popover p-0.5 shadow-md"
      :style="{ left: menu.left, top: menu.top }"
      role="menu"
      @click.stop
    >
      <button
        v-for="k in KINDS" :key="k.kind" type="button" role="menuitemradio"
        :aria-checked="(points[menu.index]?.kind ?? 'smooth') === k.kind"
        class="px-1.5 py-0.5 text-[10px] rounded hover:bg-muted"
        :class="(points[menu.index]?.kind ?? 'smooth') === k.kind && 'bg-primary/10 text-primary'"
        @click="chooseKind(k.kind)"
      >
        {{ k.label }}
      </button>
    </div>
  </div>
</template>

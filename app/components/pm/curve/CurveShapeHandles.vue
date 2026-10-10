<script setup lang="ts">
/**
 * Arg handles of a programmatic curve (plan M2.4), drawn as an HTML overlay
 * over the editor SVG so circles stay round in the stretched view box:
 * `edgeX` = double arrow on a flank (ew-resize), `pointOnEdge` = filled
 * circle, `lineY` = full-width line with a grip (ns-resize). Dragging snaps
 * to ticks (unless Shift is held); one drag is one scrub (one undo step);
 * double-click resets the arg to its default.
 */
import { computed } from 'vue';
import type { CurveDomain, CurveShapeValue, ShapeArgDef } from '@pixelmapper/extension-api';
import { clampArgs, getShape } from '~/utils/params/curve-shapes';
import { ACCENT, percentOf, pointerToEditor, snapToTicks } from './curve-geometry';

const props = defineProps<{
  value: CurveShapeValue;
  domain: CurveDomain;
  /** Tick positions in domain units (snapping). */
  ticks: number[];
  /** Box of the editor (pointer mapping). */
  getRect: () => DOMRect | undefined;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  update: [args: Record<string, number>];
  scrubStart: [];
  scrubEnd: [];
}>();

const def = computed(() => getShape(props.value.shape));
const args = computed(() => (def.value ? clampArgs(def.value, props.value.args) : {}));

/** Handles to draw (args with a handle kind other than `none`). */
const handles = computed(() => (def.value?.args ?? [])
  .filter(a => a.handle.kind !== 'none')
  .map(a => ({ arg: a, pos: percentOf(props.domain, a.handle.anchor(args.value)) })));

/** Clamps (and rounds) a value for `arg`. */
function fit(arg: ShapeArgDef, v: number): number {
  const c = Math.max(arg.min, Math.min(arg.max, Number.isFinite(v) ? v : arg.default));
  return (arg.step ?? 0) >= 1 ? Math.round(c / arg.step!) * arg.step! : Math.round(c * 1000) / 1000;
}

/** Emits new args with `key` set. */
function set(arg: ShapeArgDef, v: number) {
  emit('update', { ...args.value, [arg.key]: fit(arg, v) });
}

/** Starts dragging a handle (one scrub). */
function onDown(e: PointerEvent, arg: ShapeArgDef) {
  if (props.disabled || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  emit('scrubStart');
  const move = (me: PointerEvent) => {
    const rect = props.getRect();
    if (!rect) return;
    const p = pointerToEditor(me, rect, props.domain);
    if (arg.handle.snap === 'ticks' && !me.shiftKey) p.x = snapToTicks(p.x, props.ticks);
    set(arg, arg.handle.drag(args.value, p));
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    emit('scrubEnd');
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/** Resets an arg to its default (one undo step). */
function reset(arg: ShapeArgDef) {
  if (props.disabled) return;
  emit('scrubStart');
  set(arg, arg.default);
  emit('scrubEnd');
}

/** Arrow keys nudge the focused handle by one step. */
function onKey(e: KeyboardEvent, arg: ShapeArgDef) {
  const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
  if (!dir || props.disabled) return;
  e.preventDefault();
  emit('scrubStart');
  set(arg, (args.value[arg.key] ?? arg.default) + dir * (arg.step ?? 0.01));
  emit('scrubEnd');
}
</script>

<template>
  <div class="absolute inset-0 pointer-events-none">
    <template v-for="h in handles" :key="h.arg.key">
      <!-- lineY: dashed level line, full-width hit zone and a grip -->
      <template v-if="h.arg.handle.kind === 'lineY'">
        <div class="absolute inset-x-0 border-t border-dashed opacity-40" :style="{ top: h.pos.top, borderColor: ACCENT }" />
        <div
          class="absolute inset-x-0 h-2 -translate-y-1/2 pointer-events-auto cursor-ns-resize"
          :style="{ top: h.pos.top }"
          :data-handle="h.arg.key"
          @pointerdown="e => onDown(e, h.arg)"
          @dblclick.stop="reset(h.arg)"
        />
        <div
          class="absolute w-3 h-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-auto cursor-ns-resize border border-black/60"
          :style="{ ...h.pos, background: ACCENT }"
          :title="h.arg.label"
          tabindex="0"
          role="slider"
          :aria-label="h.arg.label"
          :aria-valuenow="args[h.arg.key]"
          @pointerdown="e => onDown(e, h.arg)"
          @dblclick.stop="reset(h.arg)"
          @keydown="e => onKey(e, h.arg)"
        />
      </template>
      <!-- edgeX: double arrow on the flank -->
      <div
        v-else-if="h.arg.handle.kind === 'edgeX'"
        class="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto cursor-ew-resize"
        :style="h.pos"
        :data-handle="h.arg.key"
        :title="h.arg.label"
        tabindex="0"
        role="slider"
        :aria-label="h.arg.label"
        :aria-valuenow="args[h.arg.key]"
        @pointerdown="e => onDown(e, h.arg)"
        @dblclick.stop="reset(h.arg)"
        @keydown="e => onKey(e, h.arg)"
      >
        <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden="true">
          <path d="M0 5 L5 1 L5 9 Z M16 5 L11 1 L11 9 Z" :fill="ACCENT" stroke="rgba(0,0,0,0.6)" stroke-width="1" />
          <line x1="5" y1="5" x2="11" y2="5" :stroke="ACCENT" stroke-width="2" />
        </svg>
      </div>
      <!-- pointOnEdge: filled circle -->
      <div
        v-else
        class="absolute w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-auto cursor-move border-[1.5px] border-black/60"
        :style="{ ...h.pos, background: ACCENT }"
        :data-handle="h.arg.key"
        :title="h.arg.label"
        tabindex="0"
        role="slider"
        :aria-label="h.arg.label"
        :aria-valuenow="args[h.arg.key]"
        @pointerdown="e => onDown(e, h.arg)"
        @dblclick.stop="reset(h.arg)"
        @keydown="e => onKey(e, h.arg)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * Core default of `pm.noiseHistory` (plan M9.4, revised after review): four
 * neighbouring fixtures along the spread over four steps. Coherent noise
 * makes the traces follow each other; drag up/down on the traces for the
 * coherence. Drag the top/bottom line for the highest/lowest level (band
 * shaded). Frequency (how often it is bright) shows in the traces.
 */
import { computed, ref } from 'vue';
import type { NoiseHistoryEmits, NoiseHistoryProps, NoiseHistoryValue } from '@pixelmapper/extension-api';
import { ACCENT, SVG_H, SVG_W, svgY } from './curve/curve-geometry';

const props = withDefaults(defineProps<NoiseHistoryProps>(), { disabled: false, size: 'md' });
const emit = defineEmits<NoiseHistoryEmits>();

const CYCLES = 4;
const POINTS = 96;
const TRACE_COLORS = ['#eab308', '#38bdf8', '#f472b6', '#a3e635'];
const boxRef = ref<HTMLElement | null>(null);

const v = computed<NoiseHistoryValue>(() => props.modelValue);
const traces = computed(() => props.traces?.(TRACE_COLORS.length, POINTS, CYCLES) ?? null);
const polylines = computed(() => (traces.value ?? []).map(t => Array.from(t, (y, i) => `${((i / (POINTS - 1)) * SVG_W).toFixed(1)},${svgY(y).toFixed(1)}`).join(' ')));
const hasCoherence = computed(() => v.value.coherence !== undefined);

const pct = (y: number) => `${(svgY(y) / SVG_H) * 100}%`;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Emits the value patched (live during drags). */
function set(patch: Partial<NoiseHistoryValue>) {
  emit('update:modelValue', { ...v.value, ...patch });
}

/** Pointer → (x in steps, y level) inside an element. */
function at(el: HTMLElement | null, e: { clientX: number; clientY: number }) {
  const r = el!.getBoundingClientRect();
  const fx = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
  const sy = ((e.clientY - r.top) / Math.max(1, r.height)) * SVG_H;
  return { steps: fx * CYCLES, level: Math.max(0, Math.min(1, (SVG_H - 6 - sy) / (SVG_H - 12))), dy: e.clientY };
}

/** Runs one drag (one scrub); a press without movement counts as a click. */
function drag(e: PointerEvent, el: HTMLElement | null, onMove: (p: { steps: number; level: number; dy: number }) => void, onClick?: () => void) {
  if (props.disabled || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const x0 = e.clientX;
  const y0 = e.clientY;
  let moved = false;
  const move = (me: PointerEvent) => {
    if (!moved && Math.hypot(me.clientX - x0, me.clientY - y0) < 3) return;
    if (!moved) emit('scrubStart');
    moved = true;
    onMove(at(el, me));
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (moved) emit('scrubEnd');
    else onClick?.();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

const onMax = (e: PointerEvent) => drag(e, boxRef.value, p => set({ max: r3(Math.max(p.level, v.value.min)) }));
const onMin = (e: PointerEvent) => drag(e, boxRef.value, p => set({ min: r3(Math.min(p.level, v.value.max)) }));
/** Up/down on the traces: 80 px from incoherent to fully coherent. */
function onTraces(e: PointerEvent) {
  if (!hasCoherence.value) return;
  const start = v.value.coherence ?? 0;
  const y0 = e.clientY;
  drag(e, boxRef.value, p => set({ coherence: r3(Math.max(0, Math.min(1, start + (y0 - p.dy) / 80))) }));
}
</script>

<template>
  <div class="flex flex-col gap-1" :class="disabled && 'opacity-50 pointer-events-none'">
    <div class="flex items-center justify-between text-xs text-muted-foreground">
      <span>{{ label ?? 'History' }}</span>
      <span class="font-mono text-[10px]">{{ Math.round(v.min * 100) }}–{{ Math.round(v.max * 100) }} %<template v-if="hasCoherence"> · coherence {{ Math.round((v.coherence ?? 0) * 100) }} %</template></span>
    </div>
    <div
      ref="boxRef" class="relative h-20 rounded-md border border-border/60 bg-muted/10 select-none" :class="hasCoherence && 'cursor-ns-resize'"
      data-noise-history :title="hasCoherence ? 'Drag up/down: coherence (neighbours follow each other)' : undefined" @pointerdown="onTraces"
    >
      <svg :viewBox="`0 0 ${SVG_W} ${SVG_H}`" preserveAspectRatio="none" class="absolute inset-0 w-full h-full" aria-hidden="true">
        <rect x="0" :y="svgY(v.max)" :width="SVG_W" :height="Math.max(0, svgY(v.min) - svgY(v.max))" fill="currentColor" fill-opacity="0.06" />
        <line v-for="c in CYCLES - 1" :key="c" :x1="(c / CYCLES) * SVG_W" y1="0" :x2="(c / CYCLES) * SVG_W" :y2="SVG_H" stroke="currentColor" stroke-opacity="0.08" vector-effect="non-scaling-stroke" />
        <polyline v-for="(pts, i) in polylines" :key="i" :points="pts" fill="none" :stroke="TRACE_COLORS[i]" stroke-opacity="0.8" stroke-width="1.25" vector-effect="non-scaling-stroke" />
      </svg>
      <!-- Range lines -->
      <div class="absolute inset-x-0 h-2 -translate-y-1/2 cursor-ns-resize" :style="{ top: pct(v.max) }" data-handle="max" title="Highest level" @pointerdown="onMax">
        <div class="absolute inset-x-0 top-1/2 border-t border-dashed" :style="{ borderColor: ACCENT }" />
      </div>
      <div class="absolute inset-x-0 h-2 -translate-y-1/2 cursor-ns-resize" :style="{ top: pct(v.min) }" data-handle="min" title="Lowest level" @pointerdown="onMin">
        <div class="absolute inset-x-0 top-1/2 border-t border-dashed" :style="{ borderColor: ACCENT }" />
      </div>
    </div>
    <p class="text-[10px] text-muted-foreground">Drag the lines for the range<template v-if="hasCoherence"> · drag the curves up/down for coherence</template></p>
  </div>
</template>

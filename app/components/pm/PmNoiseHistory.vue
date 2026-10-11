<script setup lang="ts">
/**
 * Core default of `pm.noiseHistory` (plan M9.4, revised after review): four
 * neighbouring fixtures along the spread over four steps. Coherent noise
 * makes the traces follow each other; drag up/down on the traces for the
 * coherence. Drag the top/bottom line for the highest/lowest level (band
 * shaded). The peaks lane below shows where peaks can fall (one per
 * 1/frequency steps): drag a marker sideways for the frequency, its end for
 * the length, click it to flip up/down; "+ Peaks" turns them on.
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
const laneRef = ref<HTMLElement | null>(null);
/** Frequency restored by "+ Peaks". */
const lastRate = ref(props.modelValue.rate > 0 ? props.modelValue.rate : 0.15);

const v = computed<NoiseHistoryValue>(() => props.modelValue);
const traces = computed(() => props.traces?.(TRACE_COLORS.length, POINTS, CYCLES) ?? null);
const polylines = computed(() => (traces.value ?? []).map(t => Array.from(t, (y, i) => `${((i / (POINTS - 1)) * SVG_W).toFixed(1)},${svgY(y).toFixed(1)}`).join(' ')));
const hasCoherence = computed(() => v.value.coherence !== undefined);

/** Peak markers: x positions (fraction of the lane) and width. */
const markers = computed(() => {
  if (v.value.rate <= 0) return [];
  const spacing = 1 / v.value.rate;
  const out: { k: number; left: number; width: number }[] = [];
  for (let k = 1; k * spacing <= CYCLES; k++) out.push({ k, left: (k * spacing) / CYCLES, width: v.value.length / CYCLES });
  return out;
});
/** "about 1 peak every N steps". */
const peakText = computed(() => {
  if (v.value.rate <= 0) return '';
  const n = 1 / v.value.rate;
  return n <= 1.05 ? 'about 1 peak per step' : `about 1 peak every ${n < 10 ? n.toFixed(1).replace(/\.0$/, '') : Math.round(n)} steps`;
});

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

/** One discrete change as its own step. */
function commit(patch: Partial<NoiseHistoryValue>) {
  if (props.disabled) return;
  emit('scrubStart');
  set(patch);
  emit('scrubEnd');
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
const onMarker = (e: PointerEvent, k: number) => drag(
  e, laneRef.value,
  p => set({ rate: r3(Math.max(0.01, Math.min(1, k / Math.max(p.steps, 0.05)))) }),
  () => commit({ dir: v.value.dir === 'up' ? 'down' : 'up' }),
);
const onLength = (e: PointerEvent, k: number) => drag(e, laneRef.value, p => set({ length: r3(Math.max(0.02, Math.min(1, p.steps - k / v.value.rate))) }));

/** Turns the peaks on (last frequency) or off. */
function togglePeaks() {
  if (v.value.rate > 0) {
    lastRate.value = v.value.rate;
    commit({ rate: 0 });
  }
  else commit({ rate: lastRate.value });
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
    <!-- Peaks lane -->
    <div ref="laneRef" class="relative h-5 rounded-sm bg-muted/10 select-none" data-peaks-lane>
      <template v-for="m in markers" :key="m.k">
        <div class="absolute bottom-0.5 h-1.5 rounded-sm opacity-70" :style="{ left: `${m.left * 100}%`, width: `${m.width * 100}%`, background: ACCENT }" />
        <div
          class="absolute bottom-0 w-1.5 h-2 cursor-ew-resize" :style="{ left: `calc(${(m.left + m.width) * 100}% - 3px)` }"
          title="Peak length" :data-event-length="m.k" @pointerdown="e => onLength(e, m.k)"
        />
        <div
          class="absolute top-0 -translate-x-1/2 text-[10px] leading-none cursor-pointer" :style="{ left: `${m.left * 100}%`, color: ACCENT }"
          :title="`Peak (${v.dir}) — drag for the frequency, click to flip`" :data-event="m.k" @pointerdown="e => onMarker(e, m.k)"
        >
          {{ v.dir === 'up' ? '▲' : '▼' }}
        </div>
      </template>
      <button
        v-if="v.rate <= 0" type="button" class="absolute inset-y-0 left-1 my-auto h-4 px-1.5 rounded text-[10px] text-muted-foreground border border-border/60 hover:text-foreground hover:bg-muted/50"
        data-peaks-add @click.stop="togglePeaks"
      >
        + Peaks
      </button>
    </div>
    <div class="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
      <span class="truncate">{{ v.rate > 0 ? peakText : 'Drag the lines for the range' }}</span>
      <button v-if="v.rate > 0" type="button" class="shrink-0 hover:text-foreground" data-peaks-remove @click.stop="togglePeaks">Remove peaks</button>
    </div>
  </div>
</template>

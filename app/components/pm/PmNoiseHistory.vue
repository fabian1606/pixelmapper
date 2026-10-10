<script setup lang="ts">
/**
 * Core default of `pm.noiseHistory` (plan M9.4): what the noise does over
 * four steps on three virtual fixtures, with its range and events as
 * handles. Drag the top/bottom line for the highest/lowest level (band
 * shaded); event markers (▲ up / ▼ down) sit one per 1/rate steps: drag a
 * marker sideways for the rate, drag its end for the length, click it to
 * flip the direction; double-click empty space toggles events on/off.
 */
import { computed, ref } from 'vue';
import type { NoiseHistoryEmits, NoiseHistoryProps, NoiseHistoryValue } from '@pixelmapper/extension-api';
import { ACCENT, SVG_H, SVG_W, svgY } from './curve/curve-geometry';

const props = withDefaults(defineProps<NoiseHistoryProps>(), { disabled: false, size: 'md' });
const emit = defineEmits<NoiseHistoryEmits>();

const CYCLES = 4;
const POINTS = 96;
const TRACE_COLORS = ['#eab308', '#38bdf8', '#f472b6'];
const boxRef = ref<HTMLElement | null>(null);
/** Rate restored when events are toggled back on. */
const lastRate = ref(props.modelValue.rate > 0 ? props.modelValue.rate : 0.15);

const v = computed<NoiseHistoryValue>(() => props.modelValue);
const traces = computed(() => props.traces?.(3, POINTS, CYCLES) ?? null);
const polylines = computed(() => (traces.value ?? []).map(t => Array.from(t, (y, i) => `${((i / (POINTS - 1)) * SVG_W).toFixed(1)},${svgY(y).toFixed(1)}`).join(' ')));

/** Event markers: x positions (fraction of the box) and width. */
const markers = computed(() => {
  if (v.value.rate <= 0) return [];
  const spacing = 1 / v.value.rate;
  const out: { k: number; left: number; width: number }[] = [];
  for (let k = 1; k * spacing <= CYCLES; k++) out.push({ k, left: (k * spacing) / CYCLES, width: v.value.length / CYCLES });
  return out;
});

const pct = (y: number) => `${(svgY(y) / SVG_H) * 100}%`;

/** Emits the value patched (live during drags). */
function set(patch: Partial<NoiseHistoryValue>) {
  emit('update:modelValue', { ...v.value, ...patch });
}

/** Pointer → (x in steps, y level). */
function at(e: { clientX: number; clientY: number }) {
  const r = boxRef.value!.getBoundingClientRect();
  const fx = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
  const sy = ((e.clientY - r.top) / Math.max(1, r.height)) * SVG_H;
  return { steps: fx * CYCLES, level: Math.max(0, Math.min(1, (SVG_H - 6 - sy) / (SVG_H - 12))) };
}

/** Runs one drag (one scrub); returns false when nothing moved. */
function drag(e: PointerEvent, onMove: (p: { steps: number; level: number }) => void, onClick?: () => void) {
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
    onMove(at(me));
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

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const onMax = (e: PointerEvent) => drag(e, p => set({ max: r3(Math.max(p.level, v.value.min)) }));
const onMin = (e: PointerEvent) => drag(e, p => set({ min: r3(Math.min(p.level, v.value.max)) }));
const onMarker = (e: PointerEvent, k: number) => drag(
  e,
  p => set({ rate: r3(Math.max(0.01, Math.min(1, k / Math.max(p.steps, 0.05)))) }),
  () => { emit('scrubStart'); set({ dir: v.value.dir === 'up' ? 'down' : 'up' }); emit('scrubEnd'); },
);
const onLength = (e: PointerEvent, k: number) => drag(e, p => set({ length: r3(Math.max(0.02, Math.min(1, p.steps - k / v.value.rate))) }));

/** Double-click on empty space toggles the events. */
function toggleEvents() {
  if (props.disabled) return;
  emit('scrubStart');
  if (v.value.rate > 0) {
    lastRate.value = v.value.rate;
    set({ rate: 0 });
  }
  else set({ rate: lastRate.value });
  emit('scrubEnd');
}
</script>

<template>
  <div class="flex flex-col gap-1" :class="disabled && 'opacity-50 pointer-events-none'">
    <div class="flex items-center justify-between text-xs text-muted-foreground">
      <span>{{ label ?? 'History' }}</span>
      <span class="font-mono text-[10px]">{{ Math.round(v.min * 100) }}–{{ Math.round(v.max * 100) }} %<template v-if="v.rate > 0"> · events {{ v.dir === 'up' ? '▲' : '▼' }}</template></span>
    </div>
    <div ref="boxRef" class="relative h-20 rounded-md border border-border/60 bg-muted/10 select-none" data-noise-history @dblclick="toggleEvents">
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
      <!-- Event markers -->
      <template v-for="m in markers" :key="m.k">
        <div
          class="absolute bottom-0.5 h-1.5 rounded-sm opacity-70" :style="{ left: `${m.left * 100}%`, width: `${m.width * 100}%`, background: ACCENT }"
        />
        <div
          class="absolute bottom-0 w-1.5 h-2 cursor-ew-resize" :style="{ left: `calc(${(m.left + m.width) * 100}% - 3px)` }"
          title="Event length" :data-event-length="m.k" @pointerdown="e => onLength(e, m.k)" @dblclick.stop
        />
        <div
          class="absolute bottom-2 -translate-x-1/2 text-[10px] leading-none cursor-pointer" :style="{ left: `${m.left * 100}%`, color: ACCENT }"
          :title="`Event (${v.dir}) — drag for rate, click to flip`" :data-event="m.k" @pointerdown="e => onMarker(e, m.k)" @dblclick.stop
        >
          {{ v.dir === 'up' ? '▲' : '▼' }}
        </div>
      </template>
    </div>
    <p class="text-[10px] text-muted-foreground">Drag the lines for the range · double-click to toggle events</p>
  </div>
</template>

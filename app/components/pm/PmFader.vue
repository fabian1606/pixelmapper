<script setup lang="ts">
/**
 * Core default of `pm.fader` (ADR §5.4).
 *
 * Two presentations:
 * - `track` (default): linear fill slider; click/drag sets the value at the
 *   pointer (live slider style, horizontal or vertical).
 * - `box`: compact square swatch dragged horizontally, 150 px = full range
 *   (property sidebar style, from the former FixturePropertyControlBox).
 */
import { computed } from 'vue';
import type { FaderEmits, FaderProps } from '@pixelmapper/extension-api';
import { clampStep, usePointerScrub } from './use-pointer-scrub';

const props = withDefaults(defineProps<FaderProps>(), {
  min: 0,
  max: 1,
  size: 'md',
  orientation: 'horizontal',
  showValue: true,
  variant: 'track',
  disabled: false,
});

const emit = defineEmits<FaderEmits>();

/** Value normalized to 0–1. */
const norm = computed(() => {
  const span = props.max - props.min;
  return span === 0 ? 0 : (props.modelValue - props.min) / span;
});

/** Emits a new value (clamped/stepped) if it changed. */
function set(v: number) {
  const next = clampStep(v, props.min, props.max, props.step);
  if (next !== props.modelValue) emit('update:modelValue', next);
}

// ── Track: absolute positioning ─────────────────

/** Maps a pointer position on the element to a value. */
function valueAt(e: PointerEvent, el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  const t = props.orientation === 'vertical'
    ? 1 - (e.clientY - r.top) / r.height
    : (e.clientX - r.left) / r.width;
  return props.min + Math.max(0, Math.min(1, t)) * (props.max - props.min);
}

const track = usePointerScrub({
  onStart: (e, el) => { emit('scrubStart'); set(valueAt(e, el)); },
  onMove: (e, el) => set(valueAt(e, el)),
  onEnd: () => emit('scrubEnd'),
}, () => props.disabled);

// ── Box: relative horizontal drag ───────────────

let startX = 0;
let startValue = 0;
const box = usePointerScrub({
  onStart: (e) => { startX = e.clientX; startValue = props.modelValue; emit('scrubStart'); },
  onMove: e => set(startValue + ((e.clientX - startX) / 150) * (props.max - props.min)),
  onEnd: () => emit('scrubEnd'),
}, () => props.disabled);

// ── Presentation ────────────────────────────────

const fillColor = computed(() => props.color ?? 'var(--primary)');

/** Formatted value readout. */
const valueText = computed(() => {
  if (props.unit === '%') return `${Math.round(norm.value * 100)}%`;
  const decimals = props.step && props.step < 1 ? String(props.step).split('.')[1]?.length ?? 0 : 0;
  return `${props.modelValue.toFixed(decimals)}${props.unit ?? ''}`;
});

/** Box: inner ring. */
const boxRing = computed(() =>
  props.ringColor
    ? { boxShadow: `inset 0 0 0 2px ${props.ringColor}` }
    : { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)' });

/** Box: fill layer (static fill wins; otherwise color with value as opacity). */
const boxFill = computed(() => {
  if (props.fill) return { background: props.fill };
  if (props.color) return { backgroundColor: props.color, opacity: norm.value };
  return null;
});

const boxSize = computed(() => ({ sm: 'w-9 h-9', md: 'w-12 h-12', lg: 'w-16 h-16' })[props.size]);
</script>

<template>
  <!-- Box presentation -->
  <div
    v-if="variant === 'box'"
    class="relative flex-shrink-0 rounded-xl overflow-hidden flex items-center justify-center cursor-ew-resize touch-none"
    :class="[boxSize, boxFill ? 'bg-white/5' : 'bg-muted/40 text-muted-foreground', disabled && 'opacity-50 cursor-not-allowed']"
    :style="boxRing"
    :aria-label="label"
    role="slider"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="modelValue"
    v-bind="box.bind"
  >
    <div class="absolute inset-0 rounded-xl pointer-events-none hover-inset-ring" :class="box.scrubbing.value && 'dragging-ring'" />
    <div v-if="boxFill" class="absolute inset-0 transition-all duration-150" :style="boxFill" />
    <component :is="icon" v-if="icon" class="w-6 h-6 relative z-10 drop-shadow" :class="boxFill && 'text-white/90'" />
  </div>

  <!-- Track presentation -->
  <div
    v-else
    class="relative rounded overflow-hidden border border-white/10 touch-none select-none"
    :class="[
      orientation === 'vertical' ? 'w-full h-full flex flex-col-reverse cursor-ns-resize' : 'w-full h-7 flex cursor-ew-resize',
      disabled && 'opacity-50 pointer-events-none',
    ]"
    role="slider"
    :aria-label="label"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="modelValue"
    v-bind="track.bind"
  >
    <!-- Fill -->
    <div
      class="transition-none"
      :class="orientation === 'vertical' ? 'w-full rounded-b' : 'h-full rounded-l'"
      :style="orientation === 'vertical'
        ? { height: `${norm * 100}%`, backgroundColor: fillColor }
        : { width: `${norm * 100}%`, backgroundColor: fillColor }"
    />
    <template v-if="orientation === 'vertical'">
      <div v-if="label" class="absolute inset-0 flex items-end justify-center pb-2 pointer-events-none">
        <span class="text-xs text-white/60 truncate px-1">{{ label }}</span>
      </div>
      <div v-if="showValue" class="absolute top-2 inset-x-0 flex justify-center pointer-events-none">
        <span class="text-xs font-mono text-white/80">{{ valueText }}</span>
      </div>
    </template>
    <div v-else class="absolute inset-0 flex items-center justify-between px-2 pointer-events-none text-xs">
      <span class="text-foreground/70 truncate">{{ label }}</span>
      <span v-if="showValue" class="font-mono text-foreground/80">{{ valueText }}</span>
    </div>
  </div>
</template>

<style scoped>
.hover-inset-ring:hover {
  box-shadow: inset 0 0 0 1.5px hsl(var(--primary) / 0.5);
}
.dragging-ring {
  box-shadow: inset 0 0 0 1.5px hsl(var(--primary) / 0.8) !important;
}
</style>

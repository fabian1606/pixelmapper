<script setup lang="ts">
/**
 * `pm.colorInput` replacement: HSV color wheel (angle = hue, radius =
 * saturation, value fixed at full brightness) plus a swatch grid.
 *
 * Contract only: `modelValue` (linear RGB 0–1) in, `update:modelValue`,
 * `scrubStart`, `scrubEnd` out. During a drag the handle follows the pointer
 * locally so it stays smooth even when the caller throttles writes.
 */
import { computed, ref } from 'vue';
import type { ColorInputEmits, ColorInputProps, ColorSwatch, RgbColor } from '@pixelmapper/extension-api';
import { cssRgb, hsvToRgb, rgbToHsv } from '../utils/hsv';

const props = withDefaults(defineProps<ColorInputProps>(), { disabled: false, size: 'md' });
const emit = defineEmits<ColorInputEmits>();

const wheelRef = ref<HTMLElement | null>(null);
/** Color under the pointer during a drag (local preview). */
const preview = ref<RgbColor | null>(null);
let dragging = false;

/** Wheel size per input size; `lg` fills the container (live widgets). */
const wheelClass = computed(() => ({
  sm: 'w-32 h-32',
  md: 'w-48 h-48',
  lg: 'w-full max-w-full max-h-full aspect-square',
})[props.size]);

/** Pointer position → color (hue by angle, 0° at the top, saturation by radius). */
function colorAt(e: PointerEvent): RgbColor {
  const rect = wheelRef.value!.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const x = e.clientX - rect.left - cx;
  const y = e.clientY - rect.top - cy;
  const radius = Math.min(cx, cy);
  let hue = (Math.atan2(y, x) * 180) / Math.PI + 90;
  if (hue < 0) hue += 360;
  const s = Math.min(Math.sqrt(x * x + y * y) / radius, 1);
  return hsvToRgb({ h: hue, s, v: 1 });
}

function onPointerDown(e: PointerEvent) {
  if (props.disabled || e.button !== 0 || !wheelRef.value) return;
  e.preventDefault();
  wheelRef.value.setPointerCapture?.(e.pointerId);
  dragging = true;
  emit('scrubStart');
  set(colorAt(e));
}

function onPointerMove(e: PointerEvent) {
  if (dragging) set(colorAt(e));
}

function onPointerUp() {
  if (!dragging) return;
  dragging = false;
  preview.value = null;
  emit('scrubEnd');
}

/** Emits a color and keeps it as local preview while dragging. */
function set(c: RgbColor) {
  preview.value = c;
  emit('update:modelValue', c);
}

/** Picks a swatch as one undo step. */
function pickSwatch(s: ColorSwatch) {
  emit('scrubStart');
  emit('update:modelValue', { ...s.color });
  emit('scrubEnd');
}

/** Handle position from the shown color (hue → angle, saturation → radius). */
const handleStyle = computed(() => {
  const color = preview.value ?? props.modelValue;
  const { h, s } = rgbToHsv(color);
  const rad = ((h - 90) * Math.PI) / 180;
  return {
    left: `${50 + Math.cos(rad) * s * 50}%`,
    top: `${50 + Math.sin(rad) * s * 50}%`,
    backgroundColor: cssRgb(color),
  };
});
</script>

<template>
  <div class="flex flex-col items-center gap-4 w-full h-full" :class="disabled && 'opacity-50 pointer-events-none'">
    <div v-if="label" class="self-start text-xs text-muted-foreground">{{ label }}</div>
    <div
      ref="wheelRef"
      class="relative rounded-full shadow-inner cursor-crosshair touch-none select-none shrink-0"
      :class="wheelClass"
      style="background: conic-gradient(from 0deg, red, yellow, lime, aqua, blue, magenta, red);"
      role="slider"
      :aria-label="label ?? 'Color'"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <!-- Saturation falloff towards the white center -->
      <div class="absolute inset-0 rounded-full pointer-events-none mix-blend-screen" style="background: radial-gradient(circle at center, rgb(255,255,255) 0%, rgba(255,255,255,0) 100%);" />
      <div class="absolute inset-0 rounded-full pointer-events-none mix-blend-multiply" style="background: radial-gradient(circle at center, rgba(0,0,0,0) 0%, rgba(0,0,0,0.1) 100%);" />
      <div class="absolute w-6 h-6 -ml-3 -mt-3 rounded-full border-2 border-white shadow-md pointer-events-none" :style="handleStyle" />
    </div>

    <div v-if="swatches?.length" class="grid grid-cols-6 gap-2 px-1">
      <button
        v-for="(sw, i) in swatches"
        :key="i"
        type="button"
        class="w-8 h-8 rounded-md shadow-sm border border-border transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
        :style="{ backgroundColor: cssRgb(sw.color) }"
        :title="sw.label"
        :aria-label="sw.label ?? 'Swatch'"
        @click="pickSwatch(sw)"
      />
    </div>
  </div>
</template>

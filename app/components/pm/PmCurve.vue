<script setup lang="ts">
/**
 * Core default of `pm.curve` (ADR §5.4): editable Catmull-Rom curve of
 * normalized control points (from the former SpeedCurveEditor). Drag points,
 * click empty space to add, double-click an inner point to remove. The first
 * and last points stay pinned at x = 0 and x = 1.
 */
import { computed, ref } from 'vue';
import type { CurveEmits, CurvePoint, CurveProps } from '@pixelmapper/extension-api';
import { sampleCurve } from '~/utils/params/curve';

const props = withDefaults(defineProps<CurveProps>(), { disabled: false, size: 'md', yMax: 1 });
const emit = defineEmits<CurveEmits>();

const SVG_W = 240;
const SVG_H = 72;
const PAD_Y = 6;

const svgRef = ref<SVGSVGElement | null>(null);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/** Normalized y (0–1) → SVG y. */
const toSvgY = (y: number) => SVG_H - PAD_Y - y * (SVG_H - 2 * PAD_Y);

const height = computed(() => ({ sm: 56, md: 80, lg: 120 })[props.size]);

/** Sampled polyline of the curve. */
const polyline = computed(() => {
  const pts: string[] = [];
  for (let i = 0; i <= 120; i++) {
    const t = i / 120;
    const y = Math.min(1, sampleCurve(props.modelValue, t));
    pts.push(`${(t * SVG_W).toFixed(1)},${toSvgY(y).toFixed(1)}`);
  }
  return pts.join(' ');
});

/** Pointer position → normalized (x, y) inside the SVG. */
function rel(e: { clientX: number; clientY: number }): { x: number; y: number } {
  const r = svgRef.value!.getBoundingClientRect();
  return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp(1 - (e.clientY - r.top) / r.height, 0, 1) };
}

/** Starts dragging point `idx` (as one scrub). */
function onPointDown(e: PointerEvent, idx: number) {
  if (props.disabled) return;
  e.preventDefault();
  e.stopPropagation();
  emit('scrubStart');
  const isEnd = idx === 0 || idx === props.modelValue.length - 1;
  const move = (me: PointerEvent) => {
    const p = rel(me);
    const pts = props.modelValue.map((pt, i): CurvePoint => {
      if (i !== idx) return pt;
      if (isEnd) return { x: pt.x, y: round(p.y, 3) };
      const minX = props.modelValue[idx - 1]!.x + 0.02;
      const maxX = props.modelValue[idx + 1]!.x - 0.02;
      return { x: round(clamp(p.x, minX, maxX), 3), y: round(p.y, 3) };
    });
    emit('update:modelValue', pts);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    emit('scrubEnd');
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/** Adds a point where the background was clicked. */
function onBackgroundClick(e: MouseEvent) {
  if (props.disabled || !svgRef.value) return;
  const p = rel(e);
  if (props.modelValue.some(pt => Math.abs(pt.x - p.x) < 0.04)) return;
  const pts = [...props.modelValue, { x: round(p.x, 3), y: round(p.y, 3) }].sort((a, b) => a.x - b.x);
  emit('scrubStart');
  emit('update:modelValue', pts);
  emit('scrubEnd');
}

/** Removes an inner point. */
function onPointDblClick(e: MouseEvent, idx: number) {
  e.stopPropagation();
  if (props.disabled || idx === 0 || idx === props.modelValue.length - 1) return;
  emit('scrubStart');
  emit('update:modelValue', props.modelValue.filter((_, i) => i !== idx));
  emit('scrubEnd');
}
</script>

<template>
  <div class="flex flex-col gap-1" :class="disabled && 'opacity-50 pointer-events-none'">
    <div v-if="label" class="flex items-center justify-between text-xs text-muted-foreground">
      <span>{{ label }}</span>
      <span class="font-mono text-[10px]">0–{{ yMax }}</span>
    </div>
    <div class="rounded-md border border-border/60 bg-muted/10 overflow-hidden">
      <svg
        ref="svgRef"
        :viewBox="`0 0 ${SVG_W} ${SVG_H}`"
        preserveAspectRatio="none"
        class="w-full block touch-none"
        :style="{ height: `${height}px` }"
        role="img"
        :aria-label="label ?? 'Curve'"
        @click="onBackgroundClick"
      >
        <line
          v-for="n in [0.25, 0.5, 0.75]"
          :key="n"
          :x1="n * SVG_W" :y1="PAD_Y" :x2="n * SVG_W" :y2="SVG_H - PAD_Y"
          stroke="currentColor" stroke-opacity="0.08" stroke-width="1"
        />
        <polyline :points="polyline" fill="none" stroke="var(--primary)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
        <circle
          v-for="(pt, i) in modelValue"
          :key="i"
          :cx="pt.x * SVG_W"
          :cy="toSvgY(pt.y)"
          r="4"
          fill="var(--background)"
          stroke="var(--primary)"
          stroke-width="1.5"
          vector-effect="non-scaling-stroke"
          class="cursor-grab"
          @pointerdown="e => onPointDown(e, i)"
          @dblclick="e => onPointDblClick(e, i)"
          @click.stop
        />
      </svg>
    </div>
  </div>
</template>

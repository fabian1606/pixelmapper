<script setup lang="ts">
/**
 * Shape selector of `pm.curve` (plan M2.2): one 44×18 thumbnail per offered
 * shape (rendered from its `evaluate` with default args) plus "Free" when
 * free editing is allowed. Same look as the former WaveformEditor row.
 */
import { computed } from 'vue';
import type { CurveDomain } from '@pixelmapper/extension-api';
import { defaultArgs, evaluateCurve, getShape } from '~/utils/params/curve-shapes';
import { polylineOf } from './curve-geometry';

const props = defineProps<{
  /** Offered shape ids. */
  shapes: string[];
  /** Active shape id, or null in free mode. */
  active: string | null;
  allowFree: boolean;
  domain: CurveDomain;
  ticks: number;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  select: [shape: string];
  free: [];
}>();

const MINI_W = 44;
const MINI_H = 18;

/** Known offered shapes with their thumbnails. */
const items = computed(() => props.shapes.flatMap((id) => {
  const def = getShape(id);
  if (!def) return [];
  const value = { shape: id, args: defaultArgs(def) };
  const ctx = { ticks: props.ticks || 8 };
  const pts = polylineOf(props.domain, x => evaluateCurve(value, x, ctx, props.domain), 30, MINI_W)
    // Scale the editor's y range into the thumbnail height.
    .split(' ')
    .map((p) => {
      const [x, y] = p.split(',').map(Number) as [number, number];
      return `${x},${((y / 72) * MINI_H).toFixed(1)}`;
    })
    .join(' ');
  return [{ id, label: def.label, pts }];
}));
</script>

<template>
  <div class="flex gap-1 flex-wrap" role="toolbar" aria-label="Curve shape">
    <button
      v-for="s in items"
      :key="s.id"
      type="button"
      :aria-pressed="active === s.id"
      :disabled="disabled"
      class="flex flex-col items-center gap-0.5 px-1 py-1 rounded border transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      :class="active === s.id
        ? 'border-primary/60 bg-primary/10 text-primary'
        : 'border-border/40 bg-transparent text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/30'"
      :title="s.label"
      @click="emit('select', s.id)"
    >
      <svg :width="MINI_W" :height="MINI_H" :viewBox="`0 0 ${MINI_W} ${MINI_H}`" aria-hidden="true">
        <line :x1="0" :y1="MINI_H / 2" :x2="MINI_W" :y2="MINI_H / 2" stroke="currentColor" stroke-opacity="0.2" stroke-width="0.75" />
        <polyline :points="s.pts" fill="none" stroke="currentColor" stroke-opacity="0.85" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span class="text-[8px] font-medium leading-none max-w-[44px] truncate">{{ s.label }}</span>
    </button>
    <button
      v-if="allowFree"
      type="button"
      :aria-pressed="active === null"
      :disabled="disabled"
      class="flex flex-col items-center justify-center gap-0.5 px-1.5 py-1 rounded border transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      :class="active === null
        ? 'border-primary/60 bg-primary/10 text-primary'
        : 'border-border/40 bg-transparent text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/30'"
      title="Edit points freely"
      @click="emit('free')"
    >
      <svg :width="MINI_W" :height="MINI_H" :viewBox="`0 0 ${MINI_W} ${MINI_H}`" aria-hidden="true">
        <polyline points="2,14 14,6 26,12 42,4" fill="none" stroke="currentColor" stroke-opacity="0.85" stroke-width="1.5" />
        <circle v-for="(p, i) in [[2, 14], [14, 6], [26, 12], [42, 4]]" :key="i" :cx="p[0]" :cy="p[1]" r="1.8" fill="currentColor" />
      </svg>
      <span class="text-[8px] font-medium leading-none">Free</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { SequencerParams, SequencerPatternType } from '~/utils/engine/types';
import EditableNumber from '@/components/ui/EditableNumber.vue';

const props = defineProps<{
  sequencerParams: SequencerParams;
  strength: number;
}>();

const emit = defineEmits<{
  (e: 'update:sequencerParams', params: SequencerParams): void;
  (e: 'update:strength', value: number): void;
  (e: 'change-end'): void;
}>();

const MINI_W = 52;
const MINI_H = 28;

const PATTERN_TYPES: { type: SequencerPatternType; label: string }[] = [
  { type: 'split', label: 'Split' },
  { type: 'checkerboard', label: 'Chess' },
  { type: 'sections', label: 'Sections' },
  { type: 'scatter', label: 'Scatter' },
  { type: 'flow', label: 'Flow' },
];

// Static SVG rects for each pattern preview (white = on, dark = off)
function patternRects(type: SequencerPatternType): { x: number; y: number; w: number; h: number; on: boolean }[] {
  const rects: { x: number; y: number; w: number; h: number; on: boolean }[] = [];
  switch (type) {
    case 'split':
      rects.push({ x: 0, y: 0, w: MINI_W, h: MINI_H / 2, on: true });
      rects.push({ x: 0, y: MINI_H / 2, w: MINI_W, h: MINI_H / 2, on: false });
      break;
    case 'checkerboard': {
      const cols = 4, rows = 2;
      const cw = MINI_W / cols, ch = MINI_H / rows;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          rects.push({ x: c * cw, y: r * ch, w: cw - 0.5, h: ch - 0.5, on: (r + c) % 2 === 0 });
      break;
    }
    case 'sections': {
      const cols = 4;
      const cw = MINI_W / cols;
      for (let c = 0; c < cols; c++)
        rects.push({ x: c * cw, y: 0, w: cw - 0.5, h: MINI_H, on: c % 2 === 0 });
      break;
    }
    case 'scatter': {
      const cols = 8, rows = 4;
      const cw = MINI_W / cols, ch = MINI_H / rows;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          let h = (c * 374761393 + r * 668265263) >>> 0;
          h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
          h = (h ^ (h >>> 16)) >>> 0;
          rects.push({ x: c * cw, y: r * ch, w: cw - 0.5, h: ch - 0.5, on: h >>> 31 === 0 });
        }
      break;
    }
    case 'flow': {
      // Show a smooth blob-like preview using a simple gradient approximation
      const cols = 10, rows = 5;
      const cw = MINI_W / cols, ch = MINI_H / rows;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          // Simple deterministic smooth pattern using sin/cos
          const nx = (c / cols) * 3.2;
          const ny = (r / rows) * 3.2;
          const v = Math.sin(nx * 1.3 + 0.5) * Math.cos(ny * 1.7 + 0.8) + Math.sin((nx + ny) * 0.9);
          rects.push({ x: c * cw, y: r * ch, w: cw - 0.5, h: ch - 0.5, on: v > 0 });
        }
      break;
    }
  }
  return rects;
}

function set(patch: Partial<SequencerParams>) {
  emit('update:sequencerParams', { ...props.sequencerParams, ...patch });
}

function startStrengthDrag(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const move = (me: MouseEvent) => {
    const v = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
    emit('update:strength', Math.round(v * 100));
  };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); emit('change-end'); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  move(e);
}

function startDensityVariationDrag(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const move = (me: MouseEvent) => {
    const v = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
    set({ densityVariation: Math.round(v * 100) / 100 });
  };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); emit('change-end'); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  move(e);
}

function startDensityDrag(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const move = (me: MouseEvent) => {
    const v = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
    set({ density: Math.round(v * 100) / 100 });
  };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); emit('change-end'); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  move(e);
}
</script>

<template>
  <div class="space-y-2">
    <!-- Pattern type selector -->
    <div class="flex gap-1 flex-wrap">
      <button
        v-for="pt in PATTERN_TYPES"
        :key="pt.type"
        class="flex flex-col items-center gap-0.5 px-1 py-1 rounded border transition-all"
        :class="sequencerParams.patternType === pt.type
          ? 'border-primary/60 bg-primary/10 text-primary'
          : 'border-border/40 bg-transparent text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/30'"
        @click="set({ patternType: pt.type }); emit('change-end')"
      >
        <svg :width="MINI_W" :height="MINI_H" :viewBox="`0 0 ${MINI_W} ${MINI_H}`" class="rounded-sm overflow-hidden">
          <rect width="100%" height="100%" fill="#1a1a1a" />
          <rect
            v-for="(r, i) in patternRects(pt.type)"
            :key="i"
            :x="r.x" :y="r.y" :width="r.w" :height="r.h"
            :fill="r.on ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.6)'"
            rx="0.5"
          />
        </svg>
        <span class="text-[8px] font-medium leading-none">{{ pt.label }}</span>
      </button>
    </div>

    <!-- Controls -->
    <div class="flex flex-col gap-2">
      <!-- Strength -->
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground w-20 shrink-0">Strength</span>
        <div
          class="relative flex-1 h-3 rounded bg-muted/40 cursor-ew-resize border border-border/40"
          @mousedown.prevent="startStrengthDrag"
        >
          <div
            class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-2 border-background shadow pointer-events-none"
            :style="{ left: `calc(${strength}% - 6px)` }"
          />
        </div>
        <EditableNumber :value="strength" :min="0" :max="100" suffix="%" @commit="v => { emit('update:strength', v); emit('change-end'); }" />
      </div>

      <!-- Density variation (scatter only) -->
      <div v-if="sequencerParams.patternType === 'scatter'" class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground w-20 shrink-0">Variation</span>
        <div
          class="relative flex-1 h-3 rounded bg-muted/40 cursor-ew-resize border border-border/40"
          @mousedown.prevent="startDensityVariationDrag"
        >
          <div
            class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-2 border-background shadow pointer-events-none"
            :style="{ left: `calc(${(sequencerParams.densityVariation ?? 0) * 100}% - 6px)` }"
          />
        </div>
        <EditableNumber :value="Math.round((sequencerParams.densityVariation ?? 0) * 100)" :min="0" :max="100" suffix="%" @commit="v => { set({ densityVariation: v / 100 }); emit('change-end'); }" />
      </div>

      <!-- Density (scatter / flow) -->
      <div v-if="sequencerParams.patternType === 'scatter' || sequencerParams.patternType === 'flow'" class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground w-20 shrink-0">Density</span>
        <div
          class="relative flex-1 h-3 rounded bg-muted/40 cursor-ew-resize border border-border/40"
          @mousedown.prevent="startDensityDrag"
        >
          <div
            class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-2 border-background shadow pointer-events-none"
            :style="{ left: `calc(${sequencerParams.density * 100}% - 6px)` }"
          />
        </div>
        <EditableNumber :value="Math.round(sequencerParams.density * 100)" :min="0" :max="100" suffix="%" @commit="v => { set({ density: v / 100 }); emit('change-end'); }" />
      </div>

      <!-- Count (sections only) -->
      <div v-if="sequencerParams.patternType === 'sections'" class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground w-20 shrink-0">Sections</span>
        <EditableNumber :value="sequencerParams.count" :min="2" :max="16" @commit="v => { set({ count: v }); emit('change-end'); }" />
      </div>

    </div>
  </div>
</template>

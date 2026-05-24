<script setup lang="ts">
import type { DisplacementParams, DisplacementPatternType } from '~/utils/engine/types';
import EditableNumber from '@/components/ui/EditableNumber.vue';

const props = defineProps<{
  displacementParams: DisplacementParams;
  strength: number;
}>();

const emit = defineEmits<{
  (e: 'update:displacementParams', params: DisplacementParams): void;
  (e: 'update:strength', value: number): void;
  (e: 'change-end'): void;
}>();

const PATTERN_TYPES: { type: DisplacementPatternType; label: string; description: string }[] = [
  { type: 'perlin', label: 'Perlin', description: 'Organic smooth displacement' },
  { type: 'white', label: 'White', description: 'Random per-pixel displacement' },
];

function set(patch: Partial<DisplacementParams>) {
  emit('update:displacementParams', { ...props.displacementParams, ...patch });
}

function makeDrag(getValue: (t: number) => Partial<DisplacementParams>) {
  return (e: MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const move = (me: MouseEvent) => {
      const t = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
      set(getValue(t));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      emit('change-end');
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    move(e);
  };
}

const startAmountXDrag = makeDrag(t => ({ amountX: Math.round(t * 500) / 1000 }));
const startAmountYDrag = makeDrag(t => ({ amountY: Math.round(t * 500) / 1000 }));
const startScaleDrag   = makeDrag(t => ({ scale: Math.round((0.1 + t * 9.9) * 10) / 10 }));
const startStrengthDrag = (e: MouseEvent) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const move = (me: MouseEvent) => {
    const v = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
    emit('update:strength', Math.round(v * 100));
  };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); emit('change-end'); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  move(e);
};

const scalePercent = (v: number) => ((v - 0.1) / 9.9) * 100;
const amountPercent = (v: number) => (v / 0.5) * 100;
</script>

<template>
  <div class="space-y-2">
    <!-- Pattern type selector -->
    <div class="flex gap-1">
      <button
        v-for="pt in PATTERN_TYPES"
        :key="pt.type"
        class="flex-1 px-2 py-1.5 rounded border text-xs font-medium transition-all"
        :class="displacementParams.patternType === pt.type
          ? 'border-amber-500/60 bg-amber-500/10 text-amber-400'
          : 'border-border/40 bg-transparent text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/30'"
        @click="set({ patternType: pt.type }); emit('change-end')"
      >
        {{ pt.label }}
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
            class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-amber-400 border-2 border-background shadow pointer-events-none"
            :style="{ left: `calc(${strength}% - 6px)` }"
          />
        </div>
        <EditableNumber :value="strength" :min="0" :max="100" suffix="%" @commit="v => { emit('update:strength', v); emit('change-end'); }" />
      </div>

      <!-- Amount X -->
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground w-20 shrink-0">Amount X</span>
        <div
          class="relative flex-1 h-3 rounded bg-muted/40 cursor-ew-resize border border-border/40"
          @mousedown.prevent="startAmountXDrag"
        >
          <div
            class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-amber-400 border-2 border-background shadow pointer-events-none"
            :style="{ left: `calc(${amountPercent(displacementParams.amountX)}% - 6px)` }"
          />
        </div>
        <EditableNumber :value="parseFloat((displacementParams.amountX * 100).toFixed(1))" :min="0" :max="50" suffix="%" @commit="v => { set({ amountX: v / 100 }); emit('change-end'); }" />
      </div>

      <!-- Amount Y -->
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground w-20 shrink-0">Amount Y</span>
        <div
          class="relative flex-1 h-3 rounded bg-muted/40 cursor-ew-resize border border-border/40"
          @mousedown.prevent="startAmountYDrag"
        >
          <div
            class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-amber-400 border-2 border-background shadow pointer-events-none"
            :style="{ left: `calc(${amountPercent(displacementParams.amountY)}% - 6px)` }"
          />
        </div>
        <EditableNumber :value="parseFloat((displacementParams.amountY * 100).toFixed(1))" :min="0" :max="50" suffix="%" @commit="v => { set({ amountY: v / 100 }); emit('change-end'); }" />
      </div>

      <!-- Scale -->
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground w-20 shrink-0">Scale</span>
        <div
          class="relative flex-1 h-3 rounded bg-muted/40 cursor-ew-resize border border-border/40"
          @mousedown.prevent="startScaleDrag"
        >
          <div
            class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-amber-400 border-2 border-background shadow pointer-events-none"
            :style="{ left: `calc(${scalePercent(displacementParams.scale)}% - 6px)` }"
          />
        </div>
        <EditableNumber :value="parseFloat(displacementParams.scale.toFixed(1))" :min="0.1" :max="10" suffix="x" @commit="v => { set({ scale: v }); emit('change-end'); }" />
      </div>

      <!-- Seed (white noise only) -->
      <div v-if="displacementParams.patternType === 'white'" class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground w-20 shrink-0">Seed</span>
        <EditableNumber :value="displacementParams.seed" :min="0" :max="9999" @commit="v => { set({ seed: Math.round(v) }); emit('change-end'); }" />
      </div>
    </div>
  </div>
</template>

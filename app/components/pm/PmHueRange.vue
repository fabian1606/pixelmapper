<script setup lang="ts">
/**
 * Core default of `pm.hueRange` (plan M7.3, port of the former ColorEditor
 * hue strip): a 360° strip centered on the fixtures' hue. Drag the center to
 * shift the hue; drag within 5 % of a range edge to widen or narrow the
 * swing. Editable numbers show shift ± range. One drag is one undo step.
 */
import { computed } from 'vue';
import type { HueRangeEmits, HueRangeProps } from '@pixelmapper/extension-api';
import EditableNumber from '@/components/ui/EditableNumber.vue';

const props = withDefaults(defineProps<HueRangeProps>(), { disabled: false, size: 'md', baseHue: 0 });
const emit = defineEmits<HueRangeEmits>();

const shift = computed(() => Number(props.modelValue?.shift ?? 0));
const range = computed(() => Number(props.modelValue?.range ?? 0));

/** Strip gradient centered on the base hue. */
const stripStyle = computed(() => ({
  background: `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map(d => `hsl(${props.baseHue - 180 + d}deg,100%,50%)`).join(',')})`,
}));
const center = computed(() => (shift.value + 180) / 360);
const half = computed(() => range.value / 360);
const left = computed(() => Math.max(0, center.value - half.value));
const right = computed(() => Math.min(1, center.value + half.value));

/** Emits the composite value. */
function set(next: Partial<{ shift: number; range: number }>) {
  emit('update:modelValue', { shift: shift.value, range: range.value, ...next });
}

/** Commits a typed value as one step. */
function commit(next: Partial<{ shift: number; range: number }>) {
  emit('scrubStart');
  set(next);
  emit('scrubEnd');
}

function onDown(e: PointerEvent) {
  if (props.disabled || e.button !== 0) return;
  e.preventDefault();
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const frac = (x: number) => Math.max(0, Math.min(1, (x - rect.left) / Math.max(1, rect.width)));
  const f0 = frac(e.clientX);
  const mode = half.value > 0 && Math.abs(f0 - (center.value - half.value)) < 0.05 ? 'edge'
    : half.value > 0 && Math.abs(f0 - (center.value + half.value)) < 0.05 ? 'edge' : 'center';
  emit('scrubStart');
  const move = (me: { clientX: number }) => {
    const f = frac(me.clientX);
    if (mode === 'center') set({ shift: Math.round(f * 360 - 180) });
    else set({ range: Math.min(180, Math.max(0, Math.round(Math.abs(f - center.value) * 360))) });
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    emit('scrubEnd');
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  move(e);
}
</script>

<template>
  <div class="flex flex-col gap-1" :class="disabled && 'opacity-50 pointer-events-none'">
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs text-muted-foreground truncate">{{ label ?? 'Hue' }}</span>
      <div class="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
        <EditableNumber :value="Math.round(shift)" :min="-180" :max="180" suffix="°" @commit="(v: number) => commit({ shift: v })" />
        <span class="text-border">±</span>
        <EditableNumber :value="Math.round(range)" :min="0" :max="180" suffix="°" @commit="(v: number) => commit({ range: v })" />
      </div>
    </div>
    <div class="relative h-5 rounded cursor-ew-resize border border-border/40 overflow-hidden select-none touch-none" :style="stripStyle" data-hue-strip @pointerdown="onDown">
      <div v-if="range > 0" class="absolute top-0 h-full bg-black/25 border-x border-white/50 pointer-events-none" :style="{ left: `${left * 100}%`, width: `${(right - left) * 100}%` }" />
      <div class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-background shadow pointer-events-none z-10" :style="{ left: `calc(${center * 100}% - 6px)` }" />
      <template v-if="range > 0">
        <div class="absolute top-0 h-full w-1.5 bg-white/50 pointer-events-none z-10" :style="{ left: `${left * 100}%` }" />
        <div class="absolute top-0 h-full w-1.5 bg-white/50 pointer-events-none z-10" :style="{ left: `calc(${right * 100}% - 6px)` }" />
      </template>
    </div>
    <p class="text-[10px] text-muted-foreground">Drag center to shift · Drag edges to set range</p>
  </div>
</template>

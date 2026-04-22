<script setup lang="ts">
import { computed } from 'vue';
import type { ColorParams } from '~/utils/engine/types';
import EditableNumber from '@/components/ui/EditableNumber.vue';

const props = defineProps<{
  colorParams: ColorParams;
}>();

const emit = defineEmits<{
  (e: 'update:colorParams', params: ColorParams): void;
  (e: 'change-end'): void;
}>();

function set(patch: Partial<ColorParams>) {
  emit('update:colorParams', { ...props.colorParams, ...patch });
}

const hueShiftDeg = computed(() => Math.round(props.colorParams.hueShift));
const satPct = computed(() => Math.round(props.colorParams.saturation * 100));

// Hue strip: shows the color wheel starting at current hue offset
const hueStripStyle = computed(() => {
  const shift = props.colorParams.hueShift;
  return {
    background: `linear-gradient(to right,
      hsl(${shift}deg,100%,50%),
      hsl(${shift + 60}deg,100%,50%),
      hsl(${shift + 120}deg,100%,50%),
      hsl(${shift + 180}deg,100%,50%),
      hsl(${shift + 240}deg,100%,50%),
      hsl(${shift + 300}deg,100%,50%),
      hsl(${shift + 360}deg,100%,50%))`,
  };
});

function startHueDrag(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const move = (me: MouseEvent) => {
    const v = (me.clientX - rect.left) / rect.width;
    // Map 0–1 → -180 to +180
    const deg = Math.round(v * 360 - 180);
    set({ hueShift: Math.max(-180, Math.min(180, deg)) });
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    emit('change-end');
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  move(e);
}

function startSatDrag(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const move = (me: MouseEvent) => {
    const v = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
    set({ saturation: Math.round(v * 200) / 100 }); // 0–2
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    emit('change-end');
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  move(e);
}

const hueThumbLeft = computed(() => {
  const pct = (props.colorParams.hueShift + 180) / 360;
  return `calc(${pct * 100}% - 6px)`;
});

const satThumbLeft = computed(() => {
  const pct = Math.min(1, props.colorParams.saturation / 2);
  return `calc(${pct * 100}% - 6px)`;
});
</script>

<template>
  <div class="space-y-2">
    <!-- Hue shift -->
    <div class="flex items-center gap-2">
      <span class="text-xs text-muted-foreground w-20 shrink-0">Hue</span>
      <div
        class="relative flex-1 h-3 rounded cursor-ew-resize border border-border/40 overflow-hidden"
        :style="hueStripStyle"
        @mousedown.prevent="startHueDrag"
      >
        <div
          class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-background shadow pointer-events-none"
          :style="{ left: hueThumbLeft }"
        />
      </div>
      <EditableNumber
        :value="hueShiftDeg"
        :min="-180"
        :max="180"
        suffix="°"
        @commit="v => { set({ hueShift: v }); emit('change-end'); }"
      />
    </div>

    <!-- Saturation -->
    <div class="flex items-center gap-2">
      <span class="text-xs text-muted-foreground w-20 shrink-0">Saturation</span>
      <div
        class="relative flex-1 h-3 rounded cursor-ew-resize border border-border/40"
        style="background: linear-gradient(to right, #888, hsl(0deg,100%,50%))"
        @mousedown.prevent="startSatDrag"
      >
        <div
          class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-2 border-background shadow pointer-events-none"
          :style="{ left: satThumbLeft }"
        />
      </div>
      <EditableNumber
        :value="satPct"
        :min="0"
        :max="200"
        suffix="%"
        @commit="v => { set({ saturation: v / 100 }); emit('change-end'); }"
      />
    </div>
  </div>
</template>

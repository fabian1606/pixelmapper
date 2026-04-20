<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import type { NoiseParams, NoiseType, SpeedConfig } from '~/utils/engine/types';
import { sampleNoiseGrid } from '~/utils/engine/effects/noise-math';
import EditableNumber from '@/components/ui/EditableNumber.vue';

const props = defineProps<{
  noiseParams: NoiseParams;
  speed?: SpeedConfig;
  strength: number;
}>();

const emit = defineEmits<{
  (e: 'update:noiseParams', params: NoiseParams): void;
  (e: 'update:strength', value: number): void;
  (e: 'change-end'): void;
}>();

// ─── SVG dimensions ───────────────────────────────────────────────────────────
const SVG_W = 240;
const SVG_H = 72;
const MINI_W = 52;
const MINI_H = 18;

// ─── Grid config ──────────────────────────────────────────────────────────────
const GRID_COLS = 20;
const GRID_ROWS = 6;
const CELL_W = SVG_W / GRID_COLS;
const CELL_H = SVG_H / GRID_ROWS;

// ─── Animation ────────────────────────────────────────────────────────────────
const animTime = ref(0);
let rafId: number | null = null;
let lastTs: number | null = null;

function tick(ts: number) {
  if (lastTs !== null) animTime.value += ts - lastTs;
  lastTs = ts;
  rafId = requestAnimationFrame(tick);
}

onMounted(() => { rafId = requestAnimationFrame(tick); });
onUnmounted(() => { if (rafId !== null) cancelAnimationFrame(rafId); });

// ─── Grid cells ───────────────────────────────────────────────────────────────
const gridCells = computed(() =>
  sampleNoiseGrid(props.noiseParams.noiseType, props.noiseParams, animTime.value, GRID_COLS, GRID_ROWS)
);

function cellColor(value: number, rgb?: [number, number, number]): string {
  if (rgb) {
    const r = Math.round(rgb[0] * 255);
    const g = Math.round(rgb[1] * 255);
    const b = Math.round(rgb[2] * 255);
    return `rgb(${r},${g},${b})`;
  }
  const v = Math.round(value * 255);
  return `rgb(${v},${v},${v})`;
}

// ─── Mini type previews ───────────────────────────────────────────────────────
const NOISE_TYPES: { type: NoiseType; label: string }[] = [
  { type: 'white', label: 'White' },
  { type: 'perlin', label: 'Perlin' },
  { type: 'step', label: 'Step' },
];

const MINI_COLS = 8;
const MINI_ROWS = 3;

function miniCells(type: NoiseType) {
  const staticTime = type === 'perlin' ? 1234 : 0;
  return sampleNoiseGrid(type, { noiseType: type, scale: 1, channelMode: 'linked', colorVariation: 0, fade: 0 }, staticTime, MINI_COLS, MINI_ROWS);
}

// ─── Update helpers ───────────────────────────────────────────────────────────
function set(patch: Partial<NoiseParams>) {
  emit('update:noiseParams', { ...props.noiseParams, ...patch });
}

const showColorVariation = computed(() => props.noiseParams.channelMode === 'independent');

function startColorVariationDrag(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const move = (me: MouseEvent) => {
    const v = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
    set({ colorVariation: Math.round(v * 100) / 100 });
  };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); emit('change-end'); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  move(e);
}

function startScaleDrag(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const move = (me: MouseEvent) => {
    const t = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
    const scale = Math.round((0.1 + t * 9.9) * 10) / 10;
    set({ scale });
  };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); emit('change-end'); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  move(e);
}

function startFadeDrag(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const move = (me: MouseEvent) => {
    const v = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
    set({ fade: Math.round(v * 100) / 100 });
  };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); emit('change-end'); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  move(e);
}

function startThresholdDrag(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const move = (me: MouseEvent) => {
    const v = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
    set({ threshold: Math.round(v * 100) / 100 });
  };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); emit('change-end'); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  move(e);
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

const showFade = computed(() => props.noiseParams.noiseType === 'white' || props.noiseParams.noiseType === 'step');
</script>

<template>
  <div class="space-y-2">
    <!-- Type selector row -->
    <div class="flex gap-1 flex-wrap">
      <button
        v-for="nt in NOISE_TYPES"
        :key="nt.type"
        class="flex flex-col items-center gap-0.5 px-1 py-1 rounded border transition-all"
        :class="noiseParams.noiseType === nt.type
          ? 'border-primary/60 bg-primary/10 text-primary'
          : 'border-border/40 bg-transparent text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/30'"
        @click="set({ noiseType: nt.type }); emit('change-end')"
      >
        <svg :width="MINI_W" :height="MINI_H" :viewBox="`0 0 ${MINI_W} ${MINI_H}`">
          <rect
            v-for="cell in miniCells(nt.type)"
            :key="`${cell.col}-${cell.row}`"
            :x="cell.col * (MINI_W / MINI_COLS)"
            :y="cell.row * (MINI_H / MINI_ROWS)"
            :width="MINI_W / MINI_COLS - 0.5"
            :height="MINI_H / MINI_ROWS - 0.5"
            :fill="cellColor(cell.value, cell.rgb)"
            fill-opacity="0.85"
            rx="0.5"
          />
        </svg>
        <span class="text-[8px] font-medium leading-none">{{ nt.label }}</span>
      </button>
    </div>

    <!-- Main noise grid preview -->
    <div class="rounded-md border border-border/60 bg-muted/10 overflow-hidden">
      <svg
        :viewBox="`0 0 ${SVG_W} ${SVG_H}`"
        preserveAspectRatio="none"
        class="w-full block"
        :style="{ height: '80px' }"
      >
        <rect
          v-for="cell in gridCells"
          :key="`${cell.col}-${cell.row}`"
          :x="cell.col * CELL_W"
          :y="cell.row * CELL_H"
          :width="CELL_W - 1"
          :height="CELL_H - 1"
          :fill="cellColor(cell.value, cell.rgb)"
          rx="1"
        />
      </svg>
    </div>

    <!-- Controls row -->
    <div class="flex flex-col gap-2">
      <!-- Strength -->
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground w-24 shrink-0">Strength</span>
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

      <!-- Color variation slider (always visible) -->
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground w-24 shrink-0">Color Variation</span>
        <div
          class="relative flex-1 h-3 rounded bg-muted/40 cursor-ew-resize border border-border/40"
          @mousedown.prevent="startColorVariationDrag"
        >
          <div
            class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-2 border-background shadow pointer-events-none"
            :style="{ left: `calc(${noiseParams.colorVariation * 100}% - 6px)` }"
          />
        </div>
        <EditableNumber :value="Math.round(noiseParams.colorVariation * 100)" :min="0" :max="100" suffix="%" @commit="v => { set({ colorVariation: v / 100 }); emit('change-end'); }" />
      </div>

      <!-- Scale control (Perlin only) -->
      <div v-if="noiseParams.noiseType === 'perlin'" class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground w-24 shrink-0">Scale</span>
        <div
          class="relative flex-1 h-3 rounded bg-muted/40 cursor-ew-resize border border-border/40"
          @mousedown.prevent="startScaleDrag"
        >
          <div
            class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-2 border-background shadow pointer-events-none"
            :style="{ left: `calc(${((noiseParams.scale - 0.1) / 9.9) * 100}% - 6px)` }"
          />
        </div>
        <EditableNumber :value="parseFloat(noiseParams.scale.toFixed(1))" :min="0.1" :max="10" suffix="x" @commit="v => { set({ scale: v }); emit('change-end'); }" />
      </div>

      <!-- Fade control (White / Step) -->
      <div v-if="showFade" class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground w-24 shrink-0">Fade</span>
        <div
          class="relative flex-1 h-3 rounded bg-muted/40 cursor-ew-resize border border-border/40"
          @mousedown.prevent="startFadeDrag"
        >
          <div
            class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-2 border-background shadow pointer-events-none"
            :style="{ left: `calc(${(noiseParams.fade ?? 0) * 100}% - 6px)` }"
          />
        </div>
        <EditableNumber :value="Math.round((noiseParams.fade ?? 0) * 100)" :min="0" :max="100" suffix="%" @commit="v => { set({ fade: v / 100 }); emit('change-end'); }" />
      </div>

      <!-- Threshold -->
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground w-24 shrink-0">Threshold</span>
        <div
          class="relative flex-1 h-3 rounded bg-muted/40 cursor-ew-resize border border-border/40"
          @mousedown.prevent="startThresholdDrag"
        >
          <div
            class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-2 border-background shadow pointer-events-none"
            :style="{ left: `calc(${(noiseParams.threshold ?? 0) * 100}% - 6px)` }"
          />
        </div>
        <EditableNumber :value="Math.round((noiseParams.threshold ?? 0) * 100)" :min="0" :max="100" suffix="%" @commit="v => { set({ threshold: v / 100 }); emit('change-end'); }" />
      </div>
    </div>
  </div>
</template>

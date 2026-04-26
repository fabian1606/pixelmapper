<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ColorParams, WaveformShape } from '~/utils/engine/types';
import EditableNumber from '@/components/ui/EditableNumber.vue';

const props = defineProps<{
  colorParams: ColorParams;
  waveformShape?: WaveformShape;
  baseHue?: number;  // 0..360 — actual fixture hue, used to anchor the strip gradient
}>();

const emit = defineEmits<{
  (e: 'update:colorParams', params: ColorParams): void;
  (e: 'update:waveformShape', shape: WaveformShape): void;
  (e: 'change-end'): void;
}>();

function set(patch: Partial<ColorParams>) {
  emit('update:colorParams', { ...props.colorParams, ...patch });
}

const hueShiftDeg = computed(() => Math.round(props.colorParams.hueShift));
const satPct = computed(() => Math.round(props.colorParams.saturation * 100));
const hueRangeDeg = computed(() => Math.round(props.colorParams.hueRange ?? 0));
const hasCycle = computed(() => hueRangeDeg.value > 0);

// ── Shape picker ─────────────────────────────────────────────────────────────

type ShapeOption = { label: string; shape: WaveformShape | null };

const CYCLE_SHAPES: ShapeOption[] = [
  { label: 'None',   shape: null     },
  { label: 'Circle', shape: 'sine'   },
  { label: 'Rect',   shape: 'square' },
];

const activeShape = computed<WaveformShape | null>(() =>
  hasCycle.value ? (props.waveformShape ?? 'sine') : null,
);

function selectShape(shape: WaveformShape | null) {
  if (shape === null) {
    set({ hueRange: 0, satRange: 0 });
  } else {
    emit('update:waveformShape', shape);
    if (hueRangeDeg.value === 0) {
      set({ hueRange: 10 });
    }
  }
  emit('change-end');
}

// ── Hue strip ────────────────────────────────────────────────────────────────
// Center of the strip (hueShift=0) corresponds to baseHue.
// Dragging the thumb left/right changes hueShift as a delta from baseHue.

const bh = computed(() => props.baseHue ?? 0);

// Strip gradient: starts at baseHue, wraps 360°
const hueStripStyle = computed(() => {
  const b = bh.value;
  return {
    background: [0, 60, 120, 180, 240, 300, 360]
      .map(d => `hsl(${b - 180 + d}deg,100%,50%)`)
      .join(','),
  };
});

// hueShift (-180..+180) → strip fraction (0..1)
const centerFrac = computed(() => (props.colorParams.hueShift + 180) / 360);
const rangeFrac  = computed(() => (props.colorParams.hueRange ?? 0) / 360);

const rangeLeftFrac  = computed(() => Math.max(0, centerFrac.value - rangeFrac.value));
const rangeRightFrac = computed(() => Math.min(1, centerFrac.value + rangeFrac.value));
const rangeLeft  = computed(() => `${rangeLeftFrac.value * 100}%`);
const rangeWidth = computed(() => `${(rangeRightFrac.value - rangeLeftFrac.value) * 100}%`);
const centerThumbLeft = computed(() => `calc(${centerFrac.value * 100}% - 6px)`);

// Geometric preview drawn inside the range rect (viewBox 0 0 100 20)
// sine → circle/ellipse, square → rectangle
const wavePreviewShape = computed(() => activeShape.value);

// Drag logic
const dragging = ref<'center' | 'left' | 'right' | null>(null);

function hueStripMousedown(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const frac = (e.clientX - rect.left) / rect.width;
  const range = rangeFrac.value;
  const center = centerFrac.value;

  const leftEdge = center - range;
  const rightEdge = center + range;
  const edgeThreshold = 0.05;

  let dragMode: 'center' | 'left' | 'right';
  if (range > 0 && Math.abs(frac - leftEdge) < edgeThreshold) {
    dragMode = 'left';
  } else if (range > 0 && Math.abs(frac - rightEdge) < edgeThreshold) {
    dragMode = 'right';
  } else {
    dragMode = 'center';
  }
  dragging.value = dragMode;

  const move = (me: MouseEvent) => {
    const f = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
    if (dragMode === 'center') {
      set({ hueShift: Math.round(f * 360 - 180) });
    } else if (dragMode === 'left') {
      const newRange = Math.max(0, Math.round((centerFrac.value - f) * 180));
      set({ hueRange: Math.min(180, newRange) });
    } else {
      const newRange = Math.max(0, Math.round((f - centerFrac.value) * 180));
      set({ hueRange: Math.min(180, newRange) });
    }
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    dragging.value = null;
    emit('change-end');
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  move(e);
}

// ── Saturation strip ─────────────────────────────────────────────────────────

function startSatDrag(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const move = (me: MouseEvent) => {
    const v = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
    set({ saturation: Math.round(v * 200) / 100 });
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
const satThumbLeft = computed(() => `calc(${Math.min(1, props.colorParams.saturation / 2) * 100}% - 6px)`);
</script>

<template>
  <div class="space-y-2">

    <!-- ── Cycle shape picker (above the curve) ───────────────────── -->
    <div class="space-y-1">
      <span class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Cycle</span>
      <div class="flex gap-1">
        <!-- None -->
        <button
          class="flex-1 flex flex-col items-center gap-0.5 py-1 px-1 rounded border transition-all"
          :class="activeShape === null
            ? 'border-primary/60 bg-primary/10 text-primary'
            : 'border-border/40 bg-transparent text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/30'"
          title="No cycle"
          @click="selectShape(null)"
        >
          <svg width="16" height="10" viewBox="0 0 16 10" fill="none">
            <line x1="2" y1="5" x2="14" y2="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="2 2"/>
          </svg>
          <span class="text-[9px] font-medium leading-none">None</span>
        </button>

        <!-- Circle (sine) -->
        <button
          class="flex-1 flex flex-col items-center gap-0.5 py-1 px-1 rounded border transition-all"
          :class="activeShape === 'sine'
            ? 'border-primary/60 bg-primary/10 text-primary'
            : 'border-border/40 bg-transparent text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/30'"
          title="Smooth cycle (sine)"
          @click="selectShape('sine')"
        >
          <svg width="16" height="10" viewBox="0 0 16 10" fill="none">
            <circle cx="8" cy="5" r="4" stroke="currentColor" stroke-width="1.5"/>
          </svg>
          <span class="text-[9px] font-medium leading-none">Circle</span>
        </button>

        <!-- Rect (square) -->
        <button
          class="flex-1 flex flex-col items-center gap-0.5 py-1 px-1 rounded border transition-all"
          :class="activeShape === 'square'
            ? 'border-primary/60 bg-primary/10 text-primary'
            : 'border-border/40 bg-transparent text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/30'"
          title="Hard jump (square)"
          @click="selectShape('square')"
        >
          <svg width="16" height="10" viewBox="0 0 16 10" fill="none">
            <rect x="2" y="2" width="12" height="6" rx="0.5" stroke="currentColor" stroke-width="1.5"/>
          </svg>
          <span class="text-[9px] font-medium leading-none">Rect</span>
        </button>
      </div>
    </div>

    <!-- ── Hue strip ──────────────────────────────────────────────── -->
    <div class="space-y-1">
      <div class="flex items-center justify-between">
        <span class="text-xs text-muted-foreground">Hue</span>
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <EditableNumber
            :value="hueShiftDeg"
            :min="-180"
            :max="180"
            suffix="°"
            @commit="v => { set({ hueShift: v }); emit('change-end'); }"
          />
          <span class="text-border">±</span>
          <EditableNumber
            :value="hueRangeDeg"
            :min="0"
            :max="180"
            suffix="°"
            @commit="v => { set({ hueRange: v }); emit('change-end'); }"
          />
        </div>
      </div>

      <!-- Interactive hue strip -->
      <div
        class="relative h-5 rounded cursor-ew-resize border border-border/40 overflow-hidden select-none"
        :style="{ background: `linear-gradient(to right, ${[0,60,120,180,240,300,360].map(d => `hsl(${bh-180+d}deg,100%,50%)`).join(',')})` }"
        @mousedown.prevent="hueStripMousedown"
      >
        <!-- Range highlight rect -->
        <div
          v-if="hueRangeDeg > 0"
          class="absolute top-0 h-full bg-black/25 border-x border-white/50 pointer-events-none"
          :style="{ left: rangeLeft, width: rangeWidth }"
        >
          <!-- Geometric shape preview inside the range rect -->
          <svg
            v-if="activeShape"
            class="absolute inset-0 w-full h-full pointer-events-none"
            viewBox="0 0 100 20"
            preserveAspectRatio="none"
          >
            <!-- Circle: ellipse centered in the rect -->
            <ellipse
              v-if="wavePreviewShape === 'sine'"
              cx="50" cy="10" rx="46" ry="7"
              stroke="white" stroke-width="2" fill="none" opacity="0.7"
            />
            <!-- Rect: rectangle inset slightly -->
            <rect
              v-else-if="wavePreviewShape === 'square'"
              x="3" y="3" width="94" height="14" rx="1"
              stroke="white" stroke-width="2" fill="none" opacity="0.7"
            />
          </svg>
        </div>

        <!-- Center / base hue thumb -->
        <div
          class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-background shadow pointer-events-none z-10"
          :style="{ left: centerThumbLeft }"
        />

        <!-- Edge handles -->
        <template v-if="hueRangeDeg > 0">
          <div
            class="absolute top-0 h-full w-1.5 bg-white/50 cursor-ew-resize z-10"
            :style="{ left: rangeLeft }"
          />
          <div
            class="absolute top-0 h-full w-1.5 bg-white/50 cursor-ew-resize z-10"
            :style="{ left: `calc(${rangeLeft} + ${rangeWidth} - 6px)` }"
          />
        </template>
      </div>
      <p class="text-[10px] text-muted-foreground">Drag center to shift · Drag edges to set range</p>
    </div>

    <!-- ── Saturation ──────────────────────────────────────────────── -->
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

<script setup lang="ts">
/**
 * Movement-range pad (0–255 DMX space). Emits `input` with the new range
 * while dragging and `commit` when the drag ends.
 */
import { ref, computed, onUnmounted } from 'vue';

const props = defineProps<{
  panMin: number;
  panMax: number;
  tiltMin: number;
  tiltMax: number;
  /** Live swept position (0-255) to show as a moving dot, if sweeping. */
  sweepPan?: number | null;
  sweepTilt?: number | null;
  label?: string;
}>();

const emit = defineEmits<{
  (e: 'input', val: { panMin: number; panMax: number; tiltMin: number; tiltMax: number }): void;
  (e: 'commit'): void;
}>();

const pad = ref<HTMLElement | null>(null);
let startX = 0;
let startY = 0;
let drawing = false;

function pos(e: PointerEvent) {
  const rect = pad.value!.getBoundingClientRect();
  const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width)) / rect.width;
  const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height)) / rect.height;
  return { pan: Math.round(x * 255), tilt: Math.round(y * 255) };
}

function onDown(e: PointerEvent) {
  if (!pad.value) return;
  e.preventDefault();
  drawing = true;
  const p = pos(e);
  startX = p.pan;
  startY = p.tilt;
  emitRect(p.pan, p.tilt);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function emitRect(curPan: number, curTilt: number) {
  emit('input', {
    panMin: Math.min(startX, curPan),
    panMax: Math.max(startX, curPan),
    tiltMin: Math.min(startY, curTilt),
    tiltMax: Math.max(startY, curTilt),
  });
}

function onMove(e: PointerEvent) {
  if (!drawing) return;
  e.preventDefault();
  const p = pos(e);
  emitRect(p.pan, p.tilt);
}

function onUp() {
  if (!drawing) return;
  drawing = false;
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  emit('commit');
}

onUnmounted(() => {
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
});

const rectStyle = computed(() => ({
  left: `${(props.panMin / 255) * 100}%`,
  width: `${((props.panMax - props.panMin) / 255) * 100}%`,
  top: `${(props.tiltMin / 255) * 100}%`,
  height: `${((props.tiltMax - props.tiltMin) / 255) * 100}%`,
}));

const dotStyle = computed(() => {
  if (props.sweepPan == null || props.sweepTilt == null) return null;
  return {
    left: `${(props.sweepPan / 255) * 100}%`,
    top: `${(props.sweepTilt / 255) * 100}%`,
  };
});
</script>

<template>
  <div class="space-y-1">
    <div v-if="label" class="text-[11px] font-medium truncate">{{ label }}</div>
    <div
      ref="pad"
      class="relative aspect-square w-full rounded-md border border-border bg-muted/40 cursor-crosshair select-none overflow-hidden touch-none"
      @pointerdown="onDown"
    >
      <!-- Center cross -->
      <div class="absolute inset-y-0 left-1/2 w-px bg-border/60"></div>
      <div class="absolute inset-x-0 top-1/2 h-px bg-border/60"></div>
      <!-- Allowed region -->
      <div
        class="absolute border-2 border-primary bg-primary/15 pointer-events-none"
        :style="rectStyle"
      ></div>
      <!-- Live swept position -->
      <div
        v-if="dotStyle"
        class="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400 ring-2 ring-background pointer-events-none"
        :style="dotStyle"
      ></div>
      <!-- Axis hints -->
      <span class="absolute bottom-1 left-1 text-[9px] font-mono text-muted-foreground">PAN →</span>
      <span class="absolute top-1 left-1 text-[9px] font-mono text-muted-foreground">TILT ↓</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';

const props = defineProps<{
  label: string;
  min: number;
  max: number;
}>();

const emit = defineEmits<{
  (e: 'input', val: { min: number; max: number }): void;
  (e: 'commit'): void;
}>();

const track = ref<HTMLElement | null>(null);
let dragging: 'min' | 'max' | null = null;

const minPct = computed(() => (props.min / 255) * 100);
const maxPct = computed(() => (props.max / 255) * 100);

function valueFromEvent(e: PointerEvent): number {
  if (!track.value) return 0;
  const rect = track.value.getBoundingClientRect();
  const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  return Math.round((x / rect.width) * 255);
}

function onPointerDown(thumb: 'min' | 'max', e: PointerEvent) {
  e.preventDefault();
  dragging = thumb;
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

function onTrackDown(e: PointerEvent) {
  // Grab the nearest thumb when clicking the track.
  const v = valueFromEvent(e);
  dragging = Math.abs(v - props.min) <= Math.abs(v - props.max) ? 'min' : 'max';
  applyValue(v);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

function applyValue(v: number) {
  if (dragging === 'min') {
    emit('input', { min: Math.min(v, props.max), max: props.max });
  } else if (dragging === 'max') {
    emit('input', { min: props.min, max: Math.max(v, props.min) });
  }
}

function onPointerMove(e: PointerEvent) {
  if (!dragging) return;
  e.preventDefault();
  applyValue(valueFromEvent(e));
}

function onPointerUp() {
  if (!dragging) return;
  dragging = null;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  emit('commit');
}

onUnmounted(() => {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
});
</script>

<template>
  <div class="space-y-1">
    <div class="flex items-center justify-between text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
      <span>{{ label }}</span>
      <span class="tabular-nums">{{ min }} – {{ max }}</span>
    </div>
    <div
      ref="track"
      class="relative h-6 cursor-pointer select-none"
      @pointerdown="onTrackDown"
    >
      <!-- Rail -->
      <div class="absolute top-1/2 -translate-y-1/2 h-1.5 w-full rounded-full bg-muted"></div>
      <!-- Active fill -->
      <div
        class="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-primary"
        :style="{ left: `${minPct}%`, width: `${maxPct - minPct}%` }"
      ></div>
      <!-- Min thumb -->
      <div
        class="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow"
        :style="{ left: `${minPct}%` }"
        @pointerdown.stop="onPointerDown('min', $event)"
      ></div>
      <!-- Max thumb -->
      <div
        class="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow"
        :style="{ left: `${maxPct}%` }"
        @pointerdown.stop="onPointerDown('max', $event)"
      ></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { LiveWidget } from '~/utils/live/types';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { useEngineStore } from '~/stores/engine-store';

const props = defineProps<{
  widget: LiveWidget;
  pageId: string;
  editMode: boolean;
}>();

const liveBus = useLiveBusStore();
const engineStore = useEngineStore();

const x = ref(0.5);
const y = ref(0.5);
let dragging = false;

function applyValues(vx: number, vy: number) {
  const { mapping } = props.widget;
  if (mapping.type === 'channel' && mapping.fixtureId != null) {
    const fixture = engineStore.flatFixtures.find((f: any) => f.id === mapping.fixtureId);
    if (fixture && mapping.channelOffset != null) {
      const chX = fixture.channels[mapping.channelOffset];
      if (chX) chX.stepValues = [Math.round(vx * 255)];
      // second channel = channelOffset + 1 if not explicitly set
      const chY = fixture.channels[mapping.channelOffset + 1];
      if (chY) chY.stepValues = [Math.round(vy * 255)];
      engineStore.triggerCanvasSync?.();
    }
  }
}

function updateFromEvent(e: PointerEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const vx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const vy = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
  x.value = vx;
  y.value = vy;
  applyValues(vx, vy);
  liveBus.dispatch('widget.slide', { pageId: props.pageId, widgetId: props.widget.id, value: vx, value2: vy });
}

function onPointerDown(e: PointerEvent) {
  if (props.editMode) return;
  dragging = true;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
  updateFromEvent(e);
}

function onPointerMove(e: PointerEvent) {
  if (!dragging || props.editMode) return;
  updateFromEvent(e);
}

function onPointerUp() {
  dragging = false;
}
</script>

<template>
  <div
    class="w-full h-full rounded relative border border-white/10 overflow-hidden"
    :class="editMode ? 'pointer-events-none' : 'cursor-crosshair'"
    :style="{ backgroundColor: '#111' }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
  >
    <!-- Crosshair lines -->
    <div
      class="absolute top-0 bottom-0 w-px bg-white/20 pointer-events-none"
      :style="{ left: `${x * 100}%` }"
    />
    <div
      class="absolute left-0 right-0 h-px bg-white/20 pointer-events-none"
      :style="{ top: `${y * 100}%` }"
    />
    <!-- Dot -->
    <div
      class="absolute w-3 h-3 rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none"
      :style="{
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        backgroundColor: widget.color ?? '#6366f1',
      }"
    />
    <div class="absolute bottom-1 left-0 right-0 text-center text-xs text-white/40 pointer-events-none">
      {{ widget.label || 'XY Pad' }}
    </div>
  </div>
</template>

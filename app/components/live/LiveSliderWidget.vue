<script setup lang="ts">
import { ref, computed } from 'vue';
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

const value = ref(0); // 0–1

const fillStyle = computed(() => ({
  height: `${(1 - value.value) * 100}%`,
  backgroundColor: props.widget.color ?? '#6366f1',
}));

function applyValue(v: number) {
  const { mapping } = props.widget;
  if (mapping.type === 'channel' && mapping.fixtureId != null && mapping.channelOffset != null) {
    const fixture = engineStore.flatFixtures.find((f: any) => f.id === mapping.fixtureId);
    const ch = fixture?.channels[mapping.channelOffset];
    if (ch) {
      ch.stepValues = [Math.round(v * 255)];
      engineStore.triggerCanvasSync?.();
    }
  }
}

let dragging = false;

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

function updateFromEvent(e: PointerEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const v = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
  value.value = v;
  applyValue(v);
  liveBus.dispatch('widget.slide', { pageId: props.pageId, widgetId: props.widget.id, value: v });
}
</script>

<template>
  <div
    class="w-full h-full rounded overflow-hidden relative border border-white/10 flex flex-col-reverse"
    :class="editMode ? 'pointer-events-none' : 'cursor-ns-resize'"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
  >
    <!-- Fill from bottom -->
    <div class="w-full transition-none rounded-b" :style="fillStyle" />
    <!-- Label -->
    <div class="absolute inset-0 flex items-end justify-center pb-2 pointer-events-none">
      <span class="text-xs text-white/60 truncate px-1">{{ widget.label || 'Slider' }}</span>
    </div>
    <!-- Value readout -->
    <div class="absolute top-2 inset-x-0 flex justify-center pointer-events-none">
      <span class="text-xs font-mono text-white/80">{{ Math.round(value * 100) }}%</span>
    </div>
  </div>
</template>

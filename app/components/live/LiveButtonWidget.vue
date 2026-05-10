<script setup lang="ts">
import { ref, onUnmounted } from 'vue';
import type { LiveWidget } from '~/utils/live/types';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { useEngineStore } from '~/stores/engine-store';
import { onWidgetTrigger } from '~/composables/live-ops/live-widget-ops';
import { applyPreset } from '~/components/engine/composables/preset-apply';
import { resolvePreset } from '~/components/engine/composables/preset-resolve';

const props = defineProps<{
  widget: LiveWidget;
  pageId: string;
  editMode: boolean;
}>();

const liveBus = useLiveBusStore();
const engineStore = useEngineStore();

const pressed = ref(false);

// Listen for remote trigger events
const offTrigger = onWidgetTrigger((pageId, widgetId, active) => {
  if (pageId === props.pageId && widgetId === props.widget.id) {
    pressed.value = active;
  }
});
onUnmounted(offTrigger);

function applyMapping(active: boolean) {
  if (props.editMode) return;
  const { mapping } = props.widget;
  if (mapping.type === 'preset' && mapping.presetId && active) {
    const presets = engineStore.savedPresets;
    const preset = presets.find((p: any) => p.id === mapping.presetId);
    if (preset) {
      const resolved = resolvePreset(preset, presets);
      applyPreset(resolved, engineStore.flatFixtures, engineStore.activeEffects);
      engineStore.triggerCanvasSync?.();
    }
  } else if (mapping.type === 'channel' && mapping.fixtureId != null && mapping.channelOffset != null) {
    const fixture = engineStore.flatFixtures.find((f: any) => f.id === mapping.fixtureId);
    const ch = fixture?.channels[mapping.channelOffset];
    if (ch) {
      ch.stepValues = [active ? 255 : 0];
      engineStore.triggerCanvasSync?.();
    }
  }
}

function onPointerDown(e: PointerEvent) {
  if (props.editMode) return;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
  pressed.value = true;
  applyMapping(true);
  liveBus.dispatch('widget.trigger', { pageId: props.pageId, widgetId: props.widget.id, active: true });
}

function onPointerUp() {
  if (props.editMode) return;
  pressed.value = false;
  applyMapping(false);
  liveBus.dispatch('widget.trigger', { pageId: props.pageId, widgetId: props.widget.id, active: false });
}
</script>

<template>
  <button
    class="w-full h-full rounded flex items-center justify-center text-sm font-medium transition-all select-none border"
    :class="[
      pressed
        ? 'brightness-150 scale-95'
        : 'brightness-100 scale-100',
      editMode ? 'pointer-events-none' : 'cursor-pointer',
    ]"
    :style="{
      backgroundColor: widget.color ?? '#334155',
      borderColor: widget.color ? `${widget.color}88` : 'rgba(255,255,255,0.1)',
      color: '#fff',
    }"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
    @pointerleave="onPointerUp"
  >
    <span class="truncate px-2">{{ widget.label || widget.type }}</span>
  </button>
</template>

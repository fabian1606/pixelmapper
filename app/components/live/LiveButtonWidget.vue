<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import type { LiveWidget } from '~/utils/live/types';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { useEngineStore } from '~/stores/engine-store';
import { onWidgetTrigger } from '~/composables/live-ops/live-widget-ops';
import { useSectionBinding } from '~/composables/live-ops/use-section-binding';
import { setActivePreset, pressFlashPreset, releaseFlashPreset } from '~/components/engine/composables/preset-activation';

const props = defineProps<{
  widget: LiveWidget;
  pageId: string;
  editMode: boolean;
}>();

const liveBus = useLiveBusStore();
const engineStore = useEngineStore();

const pressed = ref(false);

const section = useSectionBinding({ widget: () => props.widget });

// Visual label/color: section binding wins when this widget is part of a section.
const displayLabel = computed(() => section.effectiveLabel.value ?? props.widget.label ?? props.widget.type);
const displayColor = computed(() => section.effectiveColor.value ?? props.widget.color ?? '#334155');

// Single/multi-select sections also light up when "active" without being held.
const visuallyActive = computed(() => pressed.value || section.isActive.value);

const offTrigger = onWidgetTrigger((pageId, widgetId, active) => {
  if (pageId === props.pageId && widgetId === props.widget.id) {
    pressed.value = active;
  }
});
onUnmounted(offTrigger);

function applyOwnMapping(active: boolean) {
  const { mapping } = props.widget;
  if (mapping.type === 'preset' && mapping.presetId) {
    const preset = engineStore.savedPresets.find((p: any) => p.id === mapping.presetId);
    if (preset?.type === 'flash') {
      if (active) pressFlashPreset(props.widget.id, mapping.presetId);
      else releaseFlashPreset(props.widget.id);
    } else if (active) {
      setActivePreset(mapping.presetId);
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
  if (section.membership.value) section.press();
  else applyOwnMapping(true);
  liveBus.dispatch('widget.trigger', { pageId: props.pageId, widgetId: props.widget.id, active: true });
}

function onPointerUp() {
  if (props.editMode) return;
  pressed.value = false;
  if (section.membership.value) section.release();
  else applyOwnMapping(false);
  liveBus.dispatch('widget.trigger', { pageId: props.pageId, widgetId: props.widget.id, active: false });
}
</script>

<template>
  <button
    class="w-full h-full rounded flex items-center justify-center text-sm font-medium transition-all select-none border"
    :class="[
      visuallyActive
        ? 'brightness-150 scale-95'
        : 'brightness-100 scale-100',
      editMode ? 'pointer-events-none' : 'cursor-pointer',
    ]"
    :style="{
      backgroundColor: displayColor,
      borderColor: `${displayColor}88`,
      color: '#fff',
    }"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
    @pointerleave="onPointerUp"
  >
    <span class="truncate px-2">{{ displayLabel }}</span>
  </button>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { LiveWidget } from '~/utils/live/types';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { applyMapping, createDimmerState } from '~/composables/live-ops/apply-mapping';
import Replaceable from '~/components/extension-host/Replaceable.vue';

const props = defineProps<{
  widget: LiveWidget;
  pageId: string;
  editMode: boolean;
}>();

const liveBus = useLiveBusStore();

const value = ref(0); // 0–1

// Per-instance virtual-dimmer base-value tracking; reset when the mapping changes.
const dimmerState = createDimmerState();
watch(() => props.widget.mapping, () => {
  dimmerState.baseValues.clear();
  dimmerState.lastTarget.clear();
}, { deep: true });

function applyValue(v: number) {
  applyMapping(props.widget.mapping, true, { key: props.widget.id, value: v, dimmerState });
}

/** Fader moved: apply locally and broadcast to collaborators. */
function onSlide(v: number) {
  value.value = v;
  applyValue(v);
  liveBus.dispatch('widget.slide', { pageId: props.pageId, widgetId: props.widget.id, value: v });
}
</script>

<template>
  <!-- pm.fader (vertical track); edit mode disables pointer interaction -->
  <Replaceable
    name="pm.fader"
    orientation="vertical"
    :model-value="value"
    :min="0"
    :max="1"
    unit="%"
    :label="widget.label || 'Slider'"
    :color="widget.color ?? '#6366f1'"
    :class="editMode && 'pointer-events-none'"
    @update:model-value="onSlide"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { LiveWidget } from '~/utils/live/types';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { applyMapping } from '~/composables/live-ops/apply-mapping';
import { formatSpeed, speedToFader } from '~/utils/live/speed-fader';
import Replaceable from '~/components/extension-host/Replaceable.vue';

const props = defineProps<{
  widget: LiveWidget;
  pageId: string;
  editMode: boolean;
}>();

const liveBus = useLiveBusStore();
const engineStore = useEngineStore();

const value = ref(0); // 0–1

/**
 * Speed faders show the current multiplier, not the raw pointer position:
 * the knob snaps to the step / dead zone, and follows speed buttons or
 * collaborators changing the speed elsewhere.
 */
const isSpeed = computed(() => props.widget.mapping.type === 'speed');
/** Master dimmer faders follow the shared level (other faders / collaborators). */
const isMaster = computed(() => props.widget.mapping.type === 'master-dimmer');
const shownValue = computed(() => {
  if (isSpeed.value) return speedToFader(engineStore.speedMultiplier, props.widget.mapping.speedMode ?? 'continuous');
  if (isMaster.value) return engineStore.masterLevel;
  return value.value;
});
const valueText = computed(() => isSpeed.value ? formatSpeed(engineStore.speedMultiplier) : undefined);

function applyValue(v: number) {
  applyMapping(props.widget.mapping, true, { key: props.widget.id, value: v });
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
    :model-value="shownValue"
    :min="0"
    :max="1"
    unit="%"
    :value-text="valueText"
    :label="widget.label || 'Slider'"
    :color="widget.color ?? '#6366f1'"
    :class="editMode && 'pointer-events-none'"
    @update:model-value="onSlide"
  />
</template>

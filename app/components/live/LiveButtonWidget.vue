<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { Zap } from 'lucide-vue-next';
import type { LiveWidget, SpeedConfig } from '~/utils/live/types';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { useEngineStore } from '~/stores/engine-store';
import { onWidgetTrigger } from '~/composables/live-ops/live-widget-ops';
import { useSectionBinding } from '~/composables/live-ops/use-section-binding';
import { applyMapping, isFlashMapping, createDimmerState } from '~/composables/live-ops/apply-mapping';
import Replaceable from '~/components/extension-host/Replaceable.vue';

const props = defineProps<{
  widget: LiveWidget;
  pageId: string;
  editMode: boolean;
}>();

const liveBus = useLiveBusStore();
const engineStore = useEngineStore();

const pressed = ref(false);

const section = useSectionBinding({ widget: () => props.widget });

const GLOBAL_FN_LABELS: Record<string, string> = { strobe: 'Strobe', blind: 'Blind', blackout: 'Blackout', speed: 'Speed' };

function speedLabel(cfg: SpeedConfig): string {
  if (cfg.multiplier === 0) return 'Freeze';
  if (cfg.multiplier === 1) return 'Reset 1×';
  if (cfg.multiplier === 0.5) return '½×';
  return `${cfg.multiplier}×`;
}

function autoLabel(w: typeof props.widget): string | null {
  const m = w.mapping;
  if (m.type === 'global-function' && m.globalFunction === 'speed') {
    return speedLabel((m.globalFunctionConfig ?? { multiplier: 1, behavior: 'latch' }) as SpeedConfig);
  }
  if (m.type === 'global-function' && m.globalFunction) return GLOBAL_FN_LABELS[m.globalFunction] ?? m.globalFunction;
  if (m.type === 'preset' && m.presetId) {
    const p = engineStore.savedPresets.find((sp: any) => sp.id === m.presetId);
    if (p?.name) return p.name;
  }
  return null;
}

// Visual label/color: section binding wins when this widget is part of a section.
const displayLabel = computed(() => section.effectiveLabel.value ?? props.widget.label ?? autoLabel(props.widget) ?? props.widget.type);
const displayColor = computed(() => section.effectiveColor.value ?? props.widget.color ?? '#334155');

// Single/multi-select sections also light up when "active" without being held.
const visuallyActive = computed(() => pressed.value || section.isActive.value);

const isFlash = computed(() => {
  // Section flash mode
  if (section.membership.value?.section.mode === 'flash') return true;
  // Section bound preset is flash
  if (section.boundPreset.value?.type === 'flash') return true;
  // Own mapping flash/overwrite/global-function detection (shared with controller twins).
  return isFlashMapping(props.widget.mapping);
});

const offTrigger = onWidgetTrigger((pageId, widgetId, active) => {
  if (pageId === props.pageId && widgetId === props.widget.id) {
    pressed.value = active;
  }
});
onUnmounted(offTrigger);

const dimmerState = createDimmerState();

function applyOwnMapping(active: boolean) {
  applyMapping(props.widget.mapping, active, { key: props.widget.id, dimmerState });
}

/** pm.button pressed. */
function onPress() {
  if (props.editMode) return;
  pressed.value = true;
  if (section.membership.value) section.press();
  else applyOwnMapping(true);
  liveBus.dispatch('widget.trigger', { pageId: props.pageId, widgetId: props.widget.id, active: true });
}

/** pm.button released. */
function onRelease() {
  if (props.editMode) return;
  pressed.value = false;
  if (section.membership.value) section.release();
  else applyOwnMapping(false);
  liveBus.dispatch('widget.trigger', { pageId: props.pageId, widgetId: props.widget.id, active: false });
}
</script>

<template>
  <!-- pm.button; edit mode disables pointer interaction -->
  <Replaceable
    name="pm.button"
    :model-value="visuallyActive"
    :label="displayLabel"
    :color="displayColor"
    :class="editMode && 'pointer-events-none'"
    @press="onPress"
    @release="onRelease"
  >
    <Zap v-if="isFlash" class="absolute bottom-0.5 right-0.5 size-2.5 text-yellow-400 drop-shadow" :stroke-width="2.5" />
  </Replaceable>
</template>

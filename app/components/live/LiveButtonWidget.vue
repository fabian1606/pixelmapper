<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { Zap } from 'lucide-vue-next';
import type { LiveWidget, SpeedConfig } from '~/utils/live/types';
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
  const { mapping } = props.widget;
  // Own mapping preset is flash or overwrite
  if (mapping.type === 'preset' && mapping.presetId) {
    const preset = engineStore.savedPresets.find((p: any) => p.id === mapping.presetId);
    if (preset?.type === 'flash' || preset?.type === 'overwrite') return true;
  }
  // Speed buttons can be latch — only flash when behavior === 'hold'
  if (mapping.type === 'global-function' && mapping.globalFunction === 'speed') {
    return (mapping.globalFunctionConfig as SpeedConfig | undefined)?.behavior === 'hold';
  }
  // Other global functions are hold-to-active (flash behavior)
  if (mapping.type === 'global-function') return true;
  return false;
});

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
    if (preset?.type === 'overwrite' && preset.overwriteTarget) {
      if (active) {
        engineStore.pressOverwrite(props.widget.id, preset.overwriteTarget, {});
        queueMicrotask(() => liveBus.dispatch('overwrite.press', {
          key: props.widget.id,
          type: preset.overwriteTarget!,
          config: {},
        }));
      } else {
        engineStore.releaseOverwrite(props.widget.id);
        queueMicrotask(() => liveBus.dispatch('overwrite.release', { key: props.widget.id }));
      }
    } else if (preset?.type === 'flash') {
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
  } else if (mapping.type === 'global-function' && mapping.globalFunction === 'speed') {
    const cfg = (mapping.globalFunctionConfig ?? { multiplier: 1, behavior: 'latch' }) as SpeedConfig;
    if (active) {
      engineStore.setSpeedMultiplier(cfg.multiplier);
      queueMicrotask(() => liveBus.dispatch('engine.speed', { multiplier: cfg.multiplier }));
    } else if (cfg.behavior === 'hold') {
      engineStore.setSpeedMultiplier(1);
      queueMicrotask(() => liveBus.dispatch('engine.speed', { multiplier: 1 }));
    }
  } else if (mapping.type === 'global-function' && mapping.globalFunction) {
    if (active) {
      engineStore.pressOverwrite(props.widget.id, mapping.globalFunction, mapping.globalFunctionConfig ?? {});
      queueMicrotask(() => liveBus.dispatch('overwrite.press', {
        key: props.widget.id,
        type: mapping.globalFunction!,
        config: mapping.globalFunctionConfig ?? {},
      }));
    } else {
      engineStore.releaseOverwrite(props.widget.id);
      queueMicrotask(() => liveBus.dispatch('overwrite.release', { key: props.widget.id }));
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
    class="w-full h-full rounded flex items-center justify-center text-sm font-medium transition-all select-none border relative"
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
    <Zap v-if="isFlash" class="absolute bottom-0.5 right-0.5 size-2.5 text-yellow-400 drop-shadow" :stroke-width="2.5" />
  </button>
</template>

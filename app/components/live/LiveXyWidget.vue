<script setup lang="ts">
/**
 * Core live widget `xy` (ADR §5.7): a 2D control rendered with the
 * replaceable `pm.xyInput` (core default: two faders; pan-tilt extension: a
 * pad). With a `channel` mapping, x drives the mapped channel and y the next
 * channel; with an `effect-param` mapping on a `point` param, x/y (0–1) drive
 * the point's x/y (shared dispatcher `apply-mapping.ts`). Values are broadcast
 * to collaborators as `widget.slide`.
 */
import { ref, watch } from 'vue';
import type { Vec2 } from '@pixelmapper/extension-api';
import type { LiveWidget } from '~/utils/live/types';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { useEngineStore } from '~/stores/engine-store';
import { applyMapping } from '~/composables/live-ops/apply-mapping';
import Replaceable from '~/components/extension-host/Replaceable.vue';

const props = defineProps<{
  widget: LiveWidget;
  pageId: string;
  editMode: boolean;
}>();

const liveBus = useLiveBusStore();
const engineStore = useEngineStore();

const value = ref<Vec2>({ x: 0.5, y: 0.5 });

/** Current value of the mapped point param (null when not mapped to one). */
function mappedPoint(): Vec2 | null {
  const { mapping } = props.widget;
  if (mapping.type !== 'effect-param' || !mapping.paramKey?.startsWith('params.')) return null;
  const effect = engineStore.modifiers.find(e => e.id === mapping.effectId);
  const v = effect?.params[mapping.paramKey.slice('params.'.length)] as Vec2 | undefined;
  return v && typeof v === 'object' && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null;
}

// Start from the param's current point when (re)bound to a point param.
watch(() => props.widget.mapping, () => {
  const p = mappedPoint();
  if (p) value.value = p;
}, { immediate: true, deep: true });

/** Writes the point to the mapped point param, or the mapped channels (x → channel, y → channel + 1). */
function applyValues(p: Vec2) {
  const { mapping } = props.widget;
  if (mapping.type === 'effect-param') {
    applyMapping(mapping, true, { key: props.widget.id, value: p.x, value2: p.y });
    return;
  }
  if (mapping.type !== 'channel' || mapping.fixtureId == null || mapping.channelOffset == null) return;
  const fixture = engineStore.flatFixtures.find(f => f.id === mapping.fixtureId);
  if (!fixture) return;
  const chX = fixture.channels[mapping.channelOffset];
  const chY = fixture.channels[mapping.channelOffset + 1];
  if (chX) chX.chaserConfig.stepValues = [Math.round(p.x * 255)];
  if (chY) chY.chaserConfig.stepValues = [Math.round(p.y * 255)];
  engineStore.markChannelsDirty();
}

/** Input moved: apply locally and broadcast. */
function onInput(p: Vec2) {
  value.value = p;
  applyValues(p);
  liveBus.dispatch('widget.slide', { pageId: props.pageId, widgetId: props.widget.id, value: p.x, value2: p.y });
}
</script>

<template>
  <div
    class="w-full h-full rounded border border-white/10 overflow-hidden p-1 flex flex-col"
    :class="editMode && 'pointer-events-none'"
  >
    <Replaceable
      name="pm.xyInput"
      size="lg"
      :model-value="value"
      :label="widget.label || 'XY'"
      @update:model-value="onInput"
    />
  </div>
</template>

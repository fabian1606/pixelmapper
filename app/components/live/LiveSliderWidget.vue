<script setup lang="ts">
import { ref, computed, watch } from 'vue';
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

// ── Dimmer-group helpers ────────────────────────────────────────────────────

// Base values captured for virtual-dimmer fixtures (no DIMMER channel).
// Key: `${fixtureId}:${channelIndex}`. Reset whenever the mapping changes.
const dimmerBaseValues = new Map<string, number>();

watch(() => props.widget.mapping, () => {
  dimmerBaseValues.clear();
}, { deep: true });

function getFixturesForDimmerGroup(): any[] {
  const { mapping } = props.widget;

  if (mapping.fixtureId != null && !mapping.groupId) {
    const f = engineStore.flatFixtures.find((f: any) => f.id === mapping.fixtureId);
    return f ? [f] : [];
  }

  if (mapping.groupId) {
    const findGroup = (nodes: any[]): any => {
      for (const node of nodes) {
        if (String(node.id) === String(mapping.groupId)) return node;
        if (node.children?.length) {
          const found = findGroup(node.children);
          if (found) return found;
        }
      }
      return null;
    };
    const group = findGroup(engineStore.sceneNodes);
    if (group?.getAllFixtures) return group.getAllFixtures();
  }

  return [];
}

function applyDimmerGroup(v: number) {
  const fixtures = getFixturesForDimmerGroup();
  let didChange = false;

  for (const fixture of fixtures) {
    const dimmerChannels = fixture.channels.filter((ch: any) => ch.role === 'DIMMER');

    if (dimmerChannels.length > 0) {
      // Real DIMMER channels → set directly
      for (const ch of dimmerChannels) {
        ch.chaserConfig.stepValues = [Math.round(v * 255)];
      }
      didChange = true;
    } else {
      // Virtual dimmer → scale COLOR channels from captured base values
      const colorChannels = fixture.channels.filter((ch: any) => ch.role === 'COLOR');
      for (let i = 0; i < fixture.channels.length; i++) {
        const ch = fixture.channels[i];
        if (ch.role !== 'COLOR') continue;
        const key = `${fixture.id}:${i}`;
        if (!dimmerBaseValues.has(key)) {
          dimmerBaseValues.set(key, ch.chaserConfig.stepValues[0] ?? 255);
        }
        const base = dimmerBaseValues.get(key)!;
        ch.chaserConfig.stepValues = [Math.round(v * base)];
      }
      if (colorChannels.length > 0) didChange = true;
    }
  }

  if (didChange) engineStore.triggerCanvasSync?.();
}

function applyValue(v: number) {
  const { mapping } = props.widget;

  if (mapping.type === 'channel') {
    if (mapping.groupId && mapping.channelType) {
      // Group channel: set all matching channel types across the group
      const fixtures = getFixturesForDimmerGroup();
      for (const fixture of fixtures) {
        for (const ch of fixture.channels) {
          if (ch.type === mapping.channelType) {
            ch.chaserConfig.stepValues = [Math.round(v * 255)];
          }
        }
      }
      engineStore.triggerCanvasSync?.();
    } else if (mapping.fixtureId != null && mapping.channelOffset != null) {
      const fixture = engineStore.flatFixtures.find((f: any) => f.id === mapping.fixtureId);
      const ch = fixture?.channels[mapping.channelOffset];
      if (ch) {
        ch.chaserConfig.stepValues = [Math.round(v * 255)];
        engineStore.triggerCanvasSync?.();
      }
    }
  } else if (mapping.type === 'dimmer-group') {
    applyDimmerGroup(v);
  } else if (mapping.type === 'effect-param' && mapping.effectId != null && mapping.paramKey != null) {
    const effect = engineStore.activeEffects.find((e: any) => e.id === mapping.effectId);
    if (effect) {
      const key = mapping.paramKey;
      if (key === 'strength') {
        effect.strength = v;
      } else if (key === 'speed') {
        if (effect.speed) effect.speed.timeMs = Math.max(100, Math.round(50 + v * 5000));
      } else if (key === 'fanning') {
        effect.fanning = v;
      } else if (key.startsWith('waveformParams.')) {
        const paramName = key.split('.')[1];
        if (!effect.waveformParams) effect.waveformParams = { param: 0.5, start: 0, end: 1 };
        if (paramName === 'param') effect.waveformParams.param = v;
        else if (paramName === 'start') effect.waveformParams.start = v;
        else if (paramName === 'end') effect.waveformParams.end = v;
      }
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

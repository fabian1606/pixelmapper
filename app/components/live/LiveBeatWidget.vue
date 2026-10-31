<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import type { LiveWidget } from '~/utils/live/types';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { recordLiveStep } from '~/composables/live-ops/live-history';
import Replaceable from '~/components/extension-host/Replaceable.vue';

const props = defineProps<{
  widget: LiveWidget;
  pageId: string;
  editMode: boolean;
}>();

const engineStore = useEngineStore();
const liveBus = useLiveBusStore();

const bpm = computed(() => engineStore.engine?.globalBpm.value ?? 120);
const displayColor = computed(() => props.widget.color ?? '#1e293b');

// Beat pulse animation
const beatActive = ref(false);
let intervalId: ReturnType<typeof setInterval> | null = null;
let beatTimeout: ReturnType<typeof setTimeout> | null = null;

function pulse() {
  beatActive.value = true;
  setTimeout(() => { beatActive.value = false; }, 120);
}

function startBeatInterval() {
  if (intervalId) clearInterval(intervalId);
  if (beatTimeout) clearTimeout(beatTimeout);
  const ms = 60000 / (bpm.value || 120);
  const elapsed = Date.now() - engineStore.clockEpoch;
  const phase = ((elapsed % ms) + ms) % ms;
  const delay = ms - phase;
  beatTimeout = setTimeout(() => {
    pulse();
    intervalId = setInterval(pulse, ms);
  }, delay);
}

onMounted(() => {
  watch([bpm, () => engineStore.clockEpoch], startBeatInterval, { immediate: true });
});
onUnmounted(() => {
  if (intervalId) clearInterval(intervalId);
  if (beatTimeout) clearTimeout(beatTimeout);
  if (tapResetTimer) clearTimeout(tapResetTimer);
});

// Tap tempo: pm.tapTempo derives the BPM; the first tap of the series anchors
// the clock epoch so all clients stay phase-aligned.
const tapTimes: number[] = [];
let tapResetTimer: ReturnType<typeof setTimeout> | null = null;

function applyBpm(newBpm: number, epochMs?: number) {
  const clamped = Math.max(20, Math.min(300, Math.round(newBpm)));
  if (!engineStore.engine) return;
  // A tap series is one step: Step back returns to the tempo before it.
  recordLiveStep({ coalesce: 'bpm' });
  engineStore.baseBpm = clamped;
  const epoch = epochMs ?? Date.now();
  engineStore.setClockEpoch(epoch);
  liveBus.dispatch('engine.bpm', { bpm: clamped });
  if (epochMs !== undefined) liveBus.dispatch('engine.clock', { epochMs: epoch });
}

/** Records tap times (same 2.5 s reset / 8-tap window as the input). */
function onTap() {
  if (tapResetTimer) clearTimeout(tapResetTimer);
  tapResetTimer = setTimeout(() => { tapTimes.length = 0; }, 2500);
  tapTimes.push(Date.now());
  if (tapTimes.length > 8) tapTimes.shift();
}

/** New tempo from the tap input. */
function onBpm(newBpm: number) {
  applyBpm(newBpm, tapTimes[0]);
}
</script>

<template>
  <!-- pm.tapTempo; edit mode disables pointer interaction -->
  <Replaceable
    name="pm.tapTempo"
    :model-value="bpm"
    :phase="beatActive ? 0 : 0.5"
    :color="displayColor"
    :class="editMode && 'pointer-events-none'"
    @tap="onTap"
    @update:model-value="onBpm"
  />
</template>

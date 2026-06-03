<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import type { LiveWidget } from '~/utils/live/types';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveBusStore } from '~/stores/live-bus-store';

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

// Tap tempo
const tapTimes = ref<number[]>([]);
let tapResetTimer: ReturnType<typeof setTimeout> | null = null;

function applyBpm(newBpm: number, epochMs?: number) {
  const clamped = Math.max(20, Math.min(300, Math.round(newBpm)));
  if (!engineStore.engine) return;
  engineStore.baseBpm = clamped;
  const epoch = epochMs ?? Date.now();
  engineStore.setClockEpoch(epoch);
  liveBus.dispatch('engine.bpm', { bpm: clamped });
  if (epochMs !== undefined) liveBus.dispatch('engine.clock', { epochMs: epoch });
}

function onTap() {
  if (props.editMode) return;
  const now = Date.now();
  if (tapResetTimer) clearTimeout(tapResetTimer);
  tapResetTimer = setTimeout(() => { tapTimes.value = []; }, 2500);

  tapTimes.value = [...tapTimes.value, now].slice(-8);

  if (tapTimes.value.length >= 2) {
    const diffs: number[] = [];
    for (let i = 1; i < tapTimes.value.length; i++) {
      diffs.push(tapTimes.value[i] - tapTimes.value[i - 1]);
    }
    applyBpm(60000 / (diffs.reduce((a, b) => a + b, 0) / diffs.length), tapTimes.value[0]);
  }
}

const tapCount = computed(() => tapTimes.value.length);
</script>

<template>
  <button
    class="w-full h-full rounded flex flex-col items-center justify-center gap-1 select-none transition-all"
    :class="editMode ? 'pointer-events-none' : 'cursor-pointer active:scale-95'"
    :style="{ backgroundColor: displayColor }"
    @pointerdown="onTap"
  >
    <span
      class="rounded-full transition-all duration-75"
      :class="beatActive ? 'w-4 h-4 opacity-100' : 'w-3 h-3 opacity-40'"
      :style="{ backgroundColor: beatActive ? '#fff' : '#fff' }"
    />
    <span class="text-white font-mono font-bold leading-none" style="font-size: clamp(10px, 2cqi, 22px)">
      {{ bpm }}
    </span>
    <span class="text-white/40 font-mono leading-none" style="font-size: clamp(7px, 1.2cqi, 11px)">
      {{ tapCount >= 2 ? `tap (${tapCount})` : 'BPM' }}
    </span>
  </button>
</template>

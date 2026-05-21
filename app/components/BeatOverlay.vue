<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useEngineStore } from '~/stores/engine-store';
import { useLiveBusStore } from '~/stores/live-bus-store';

const emit = defineEmits<{ close: [] }>();

const engineStore = useEngineStore();
const liveBus = useLiveBusStore();

const bpmInput = ref(engineStore.engine?.globalBpm.value ?? 120);

function applyBpm(newBpm: number, epochMs?: number) {
  const clamped = Math.max(20, Math.min(300, Math.round(newBpm)));
  if (!engineStore.engine) return;
  engineStore.engine.globalBpm.value = clamped;
  engineStore.engine.postBpm(clamped);
  const epoch = epochMs ?? Date.now();
  engineStore.setClockEpoch(epoch);
  liveBus.dispatch('engine.bpm', { bpm: clamped });
  if (epochMs !== undefined) liveBus.dispatch('engine.clock', { epochMs: epoch });
  bpmInput.value = clamped;
}

function onBpmInputChange(e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value);
  if (!isNaN(val) && val >= 20 && val <= 300) applyBpm(val);
}

function increment() { applyBpm((engineStore.engine?.globalBpm.value ?? 120) + 1); }
function decrement() { applyBpm((engineStore.engine?.globalBpm.value ?? 120) - 1); }

// Tap tempo
const tapTimes = ref<number[]>([]);
let tapResetTimer: ReturnType<typeof setTimeout> | null = null;

function onTap() {
  const now = Date.now();
  if (tapResetTimer) clearTimeout(tapResetTimer);
  tapResetTimer = setTimeout(() => { tapTimes.value = []; }, 2500);

  tapTimes.value = [...tapTimes.value, now].slice(-8);

  if (tapTimes.value.length >= 2) {
    const diffs: number[] = [];
    for (let i = 1; i < tapTimes.value.length; i++) {
      diffs.push(tapTimes.value[i] - tapTimes.value[i - 1]);
    }
    const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    applyBpm(60000 / avg, tapTimes.value[0]);
  }
}

const tapCount = computed(() => tapTimes.value.length);

// Close on outside click
function onDocClick(e: MouseEvent) {
  const el = document.getElementById('beat-overlay');
  if (el && !el.contains(e.target as Node)) emit('close');
}

onMounted(() => {
  bpmInput.value = engineStore.engine?.globalBpm.value ?? 120;
  setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
});
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocClick);
  if (tapResetTimer) clearTimeout(tapResetTimer);
});
</script>

<template>
  <div
    id="beat-overlay"
    class="absolute right-0 top-full mt-1 z-50 bg-sidebar border border-sidebar-border rounded-lg shadow-lg p-3 flex flex-col gap-3 min-w-[180px]"
  >
    <!-- BPM input row -->
    <div class="flex items-center gap-1">
      <span class="text-xs text-sidebar-foreground/50 font-mono w-8">BPM</span>
      <input
        type="number"
        min="20"
        max="300"
        :value="bpmInput"
        @change="onBpmInputChange"
        class="w-16 bg-sidebar-accent border border-sidebar-border rounded px-2 py-0.5 text-sm font-mono text-center text-sidebar-foreground focus:outline-none focus:border-primary"
      />
      <div class="flex flex-col">
        <button
          @click="increment"
          class="text-sidebar-foreground/40 hover:text-sidebar-foreground leading-none px-1"
          style="font-size:10px"
        >▲</button>
        <button
          @click="decrement"
          class="text-sidebar-foreground/40 hover:text-sidebar-foreground leading-none px-1"
          style="font-size:10px"
        >▼</button>
      </div>
    </div>

    <!-- Tap tempo -->
    <button
      @click="onTap"
      class="w-full py-1.5 rounded-md text-xs font-medium transition-colors border border-sidebar-border text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-primary active:text-primary-foreground"
    >
      {{ tapCount < 2 ? 'Tap Tempo' : `Tap (${tapCount})` }}
    </button>
  </div>
</template>

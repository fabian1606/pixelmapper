<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useEngineStore } from '~/stores/engine-store';
import { applyTapBpm, tapBeat } from '~/composables/live-ops/tap-tempo';

const emit = defineEmits<{ close: [] }>();

const engineStore = useEngineStore();

// The popup edits the base tempo (the music); the speed multiplier stays applied on top.
const bpmInput = ref(engineStore.baseBpm);
watch(() => engineStore.baseBpm, (bpm) => { bpmInput.value = bpm; });

function onBpmInputChange(e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value);
  if (!isNaN(val) && val >= 20 && val <= 300) applyTapBpm(val);
}

function increment() { applyTapBpm(engineStore.baseBpm + 1); }
function decrement() { applyTapBpm(engineStore.baseBpm - 1); }

// Tap tempo: shared rules (tap-tempo.ts) — every tap nudges the beat grid
// onto itself, from the second tap on the averaged tempo is applied.
const tapCount = ref(0);
let tapResetTimer: ReturnType<typeof setTimeout> | null = null;

function onTap() {
  tapBeat();
  // Counter for the label only (same 2.5 s series reset as tap-tempo.ts).
  if (tapResetTimer) clearTimeout(tapResetTimer);
  tapResetTimer = setTimeout(() => { tapCount.value = 0; }, 2500);
  tapCount.value = Math.min(8, tapCount.value + 1);
}

// Close on outside click
function onDocClick(e: MouseEvent) {
  const el = document.getElementById('beat-overlay');
  if (el && !el.contains(e.target as Node)) emit('close');
}

onMounted(() => {
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

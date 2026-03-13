<script setup lang="ts">
import { Settings, Terminal, Cable } from 'lucide-vue-next';
import { useEngineStore } from '~/stores/engine-store';
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';

const engineStore = useEngineStore();
const bpm = computed(() => engineStore.engine?.globalBpm.value ?? 120);

const beatActive = ref(false);

let intervalId: ReturnType<typeof setInterval> | null = null;
let beatTimeout: ReturnType<typeof setTimeout> | null = null;

function startBeatInterval() {
  if (intervalId) clearInterval(intervalId);
  const ms = 60000 / (bpm.value || 120);
  intervalId = setInterval(() => {
    beatActive.value = true;
    if (beatTimeout) clearTimeout(beatTimeout);
    beatTimeout = setTimeout(() => { beatActive.value = false; }, 120);
  }, ms);
}

onMounted(() => {
  watch(bpm, startBeatInterval, { immediate: true });
});

onUnmounted(() => {
  if (intervalId) clearInterval(intervalId);
  if (beatTimeout) clearTimeout(beatTimeout);
});

const tabs = [
  { label: 'Setup', icon: Settings, path: '/' },
  { label: 'Console', icon: Terminal, path: '/console' },
  { label: 'Connections', icon: Cable, path: '/connections' },
];
</script>

<template>
  <header class="flex items-center h-14 bg-sidebar border-b border-sidebar-border px-4 gap-2 shrink-0">
    <nav class="flex items-center gap-1">
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.path"
        :to="tab.path"
        class="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent"
        active-class="!text-primary-foreground !bg-primary"
        exact-active-class="!text-primary-foreground !bg-primary"
      >
        <component :is="tab.icon" :size="14" />
        {{ tab.label }}
      </NuxtLink>
    </nav>

    <div class="ml-auto flex items-center gap-2 text-xs text-sidebar-foreground/40 font-mono">
      <span
        class="inline-block w-2 h-2 rounded-full transition-colors duration-75"
        :class="beatActive ? 'bg-primary' : 'bg-sidebar-foreground/20'"
      />
      BPM: {{ bpm }}
    </div>
  </header>
</template>

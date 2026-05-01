<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { House, Sparkles, Cable, Zap } from 'lucide-vue-next';
import { useEngineStore } from '~/stores/engine-store';
import { storeToRefs } from 'pinia';
import CollaboratorsPanel from '~/components/CollaboratorsPanel.vue';

const engineStore = useEngineStore();
const { projectLoading } = storeToRefs(engineStore);
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

const route = useRoute();
const projectId = computed(() => route.params.id as string | undefined);

const tabs = computed(() => projectId.value ? [
  { label: 'Design',       icon: Sparkles, path: `/project/${projectId.value}` },
  { label: 'Live',         icon: Zap,      path: `/project/${projectId.value}/live` },
  { label: 'Connections',  icon: Cable,    path: `/project/${projectId.value}/connections` },
] : []);
</script>

<template>
  <header class="relative flex items-center h-14 bg-sidebar border-b border-sidebar-border px-4 gap-2 shrink-0">
    <nav class="flex items-center gap-2">
      <NuxtLink
        to="/"
        class="flex items-center justify-center w-8 h-8 rounded-md transition-colors text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent"
      >
        <House :size="16" />
      </NuxtLink>
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

    <div class="ml-auto flex items-center gap-4">
      <div class="flex items-center gap-2 text-xs text-sidebar-foreground/40 font-mono">
        <span
          class="inline-block w-2 h-2 rounded-full transition-colors duration-75"
          :class="beatActive ? 'bg-primary' : 'bg-sidebar-foreground/20'"
        />
        BPM: {{ bpm }}
      </div>

      <!-- Collaborators -->
      <CollaboratorsPanel v-if="projectId" :project-id="projectId" />
    </div>
    <div
      v-if="projectLoading"
      class="absolute bottom-0 left-0 h-0.5 bg-primary animate-loading-bar"
    />
  </header>
</template>

<style scoped>
@keyframes loading-bar {
  0%   { left: -40%; width: 40%; }
  50%  { left: 40%; width: 50%; }
  100% { left: 110%; width: 40%; }
}
.animate-loading-bar {
  animation: loading-bar 1.2s ease-in-out infinite;
}
</style>

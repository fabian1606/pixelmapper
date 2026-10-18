<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { House, Sparkles, Cable, Zap, Download } from 'lucide-vue-next';
import { useEngineStore } from '~/stores/engine-store';
import { storeToRefs } from 'pinia';
import CollaboratorsPanel from '~/components/CollaboratorsPanel.vue';
import BeatOverlay from '~/components/BeatOverlay.vue';
import SyncStatusIndicator from '~/components/sync/SyncStatusIndicator.vue';
import PmToolbar from '~/components/primitives/PmToolbar.vue';
import { useAsTitleBar, useWindowChrome } from '~/composables/use-window-chrome';
import { hasNativeMenu, runMenuCommand } from '~/composables/app-menu/use-app-menu';

// Desktop app (macOS): the header is the title bar, next to the traffic lights.
const { trafficLightInset } = useWindowChrome();
useAsTitleBar();

const engineStore = useEngineStore();
const { projectLoading } = storeToRefs(engineStore);
const bpm = computed(() => engineStore.engine?.globalBpm.value ?? 120);

const beatOverlayOpen = ref(false);
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
  <!-- Extension slots: header:start|end -->
  <!-- data-tauri-drag-region: empty header space drags the desktop window (no-op in browsers) -->
  <PmToolbar
    id="header"
    as="header"
    class="relative flex items-center h-12 bg-sidebar border-b border-sidebar-border pl-2 pr-4 gap-2 shrink-0 select-none"
    :style="trafficLightInset ? { paddingLeft: `${trafficLightInset}px` } : undefined"
    data-tauri-drag-region
  >
    <nav class="flex items-center gap-2" data-tauri-drag-region>
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
      <!-- Browser only: the desktop app has File → Export in its menu bar. -->
      <button
        v-if="projectId && !hasNativeMenu"
        class="flex items-center justify-center w-8 h-8 rounded-md transition-colors text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent"
        title="Export project (.pmproject) ⌘⇧E"
        :disabled="projectLoading"
        @click="runMenuCommand('file.export')"
      >
        <Download :size="16" />
      </button>
    </nav>

    <div class="ml-auto flex items-center gap-4" data-tauri-drag-region>
      <!-- Sync status of the open project (ADR 0004 D17) -->
      <SyncStatusIndicator v-if="projectId" />

      <div class="relative">
        <button
          @click="beatOverlayOpen = !beatOverlayOpen"
          class="flex items-center gap-2 text-xs text-sidebar-foreground/40 font-mono hover:text-sidebar-foreground/70 transition-colors px-1 py-0.5 rounded"
        >
          <span
            class="inline-block w-2 h-2 rounded-full transition-colors duration-75"
            :class="beatActive ? 'bg-primary' : 'bg-sidebar-foreground/20'"
          />
          BPM: {{ bpm }}
        </button>
        <BeatOverlay v-if="beatOverlayOpen" @close="beatOverlayOpen = false" />
      </div>

      <!-- Collaborators -->
      <CollaboratorsPanel v-if="projectId" :project-id="projectId" />
    </div>
    <div
      v-if="projectLoading"
      class="absolute bottom-0 left-0 h-0.5 bg-primary animate-loading-bar"
    />
  </PmToolbar>
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

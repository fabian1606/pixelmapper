<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { Pencil, Maximize, Minimize } from 'lucide-vue-next';
import LiveCanvas from '~/components/live/LiveCanvas.vue';
import LivePageSelector from '~/components/live/LivePageSelector.vue';
import LiveAddSidebar from '~/components/live/LiveAddSidebar.vue';
import LiveEditSidebar from '~/components/live/LiveEditSidebar.vue';
import { useLiveModeStore } from '~/stores/live-mode-store';
import { useLiveShortcuts } from '~/composables/use-live-shortcuts';

definePageMeta({ layout: 'project' });

const store = useLiveModeStore();
useLiveShortcuts();

const isFullscreen = ref(false);

async function toggleFullscreen() {
  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen();
  } else {
    await document.exitFullscreen();
  }
}

function onFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement;
}

onMounted(() => document.addEventListener('fullscreenchange', onFullscreenChange));
onUnmounted(() => document.removeEventListener('fullscreenchange', onFullscreenChange));
</script>

<template>
  <div class="flex h-full w-full bg-background overflow-hidden">
    <!-- Left: Add widget sidebar (edit mode only) -->
    <LiveAddSidebar v-if="store.editMode" />

    <!-- Center: Canvas with floating overlays -->
    <div class="flex-1 relative overflow-hidden">
      <LiveCanvas />

      <!-- Floating page selector bottom center -->
      <div class="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
        <div class="pointer-events-auto">
          <LivePageSelector />
        </div>
      </div>

      <!-- Floating buttons (play mode only) -->
      <div v-if="!store.editMode" class="absolute top-4 right-4 z-10 flex items-center gap-1.5">
        <button
          class="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-background/90 backdrop-blur-sm border border-border/60 shadow-lg text-muted-foreground hover:text-foreground transition-colors"
          @click="store.editMode = true"
        >
          <Pencil class="size-3.5" />
          Edit
        </button>
        <button
          class="flex items-center justify-center w-8 h-8 rounded-md bg-background/90 backdrop-blur-sm border border-border/60 shadow-lg text-muted-foreground hover:text-foreground transition-colors"
          :title="isFullscreen ? 'Vollbild beenden' : 'Vollbild'"
          @click="toggleFullscreen"
        >
          <Minimize v-if="isFullscreen" class="size-3.5" />
          <Maximize v-else class="size-3.5" />
        </button>
      </div>
    </div>

    <!-- Right: Edit sidebar (edit mode only) -->
    <LiveEditSidebar v-if="store.editMode" />
  </div>
</template>

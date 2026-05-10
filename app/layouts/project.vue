<script setup lang="ts">
import { onMounted, onUnmounted, provide, computed } from 'vue';
import { useEngineStore } from '~/stores/engine-store';
import { useCollaboration } from '~/composables/use-collaboration';
import { storeToRefs } from 'pinia';

const route = useRoute();
const projectId = computed(() => route.params.id as string);

const engineStore = useEngineStore();
engineStore.initEngine();

provide('effectEngine', engineStore.engine);

const { projectLoading, projectError } = storeToRefs(engineStore);

const collab = useCollaboration(projectId.value);

onMounted(async () => {
  await engineStore.loadProject(projectId.value);
  collab.connect();
});

onUnmounted(() => {
  engineStore.commitPendingPersistence();
  collab.cleanup();
});
</script>

<template>
  <div class="flex flex-col h-screen">
    <AppHeader class="fullscreen-hide" />
    <div class="flex-1 min-h-0">
      <div v-if="projectLoading" class="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading project…
      </div>

      <div v-else-if="projectError === 'unauthorized'" class="flex items-center justify-center h-full">
        <div class="text-center space-y-3 max-w-sm px-4">
          <div class="text-4xl">🔒</div>
          <h2 class="text-lg font-semibold">No access</h2>
          <p class="text-sm text-muted-foreground">You don't have permission to view this project. Ask the owner to invite you.</p>
          <NuxtLink to="/" class="inline-block mt-2 text-sm text-primary hover:underline">← Back to projects</NuxtLink>
        </div>
      </div>

      <div v-else-if="projectError === 'error'" class="flex items-center justify-center h-full">
        <div class="text-center space-y-3 max-w-sm px-4">
          <h2 class="text-lg font-semibold">Failed to load project</h2>
          <p class="text-sm text-muted-foreground">Something went wrong. Please try again.</p>
          <NuxtLink to="/" class="inline-block mt-2 text-sm text-primary hover:underline">← Back to projects</NuxtLink>
        </div>
      </div>

      <slot v-else />
    </div>
  </div>
</template>

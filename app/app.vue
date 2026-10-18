<script setup lang="ts">
import { useEngineStore } from '~/stores/engine-store';
import { onMounted, onBeforeUnmount } from 'vue';
import { useWakeLock, useDocumentVisibility } from '@vueuse/core';
import { watch } from 'vue';
import GlobalContextMenu from '~/components/GlobalContextMenu.vue';
import { provideRootScopes } from '~/composables/extensions/provide-root-scopes';
import ReplacementChoiceDialog from '~/components/extension-host/ReplacementChoiceDialog.vue';
import ToastStack from '~/components/ToastStack.vue';
import WindowDragStrip from '~/components/WindowDragStrip.vue';
import { useAppMenu } from '~/composables/app-menu/use-app-menu';

const engineStore = useEngineStore();

// Global extension scopes: project, selection, viewport (ADR §5.2).
provideRootScopes();

// Menu bar commands (File/View), Open Recent and their shortcuts.
useAppMenu();

const { isSupported: wakeLockSupported, isActive: wakeLockActive, request: requestWakeLock, release: releaseWakeLock } = useWakeLock();
const visibility = useDocumentVisibility();

async function acquireWakeLock() {
  if (!wakeLockSupported.value || wakeLockActive.value) return;
  try {
    await requestWakeLock('screen');
  } catch (err) {
    console.warn('[wake-lock] request failed', err);
  }
}

watch(visibility, (state) => {
  if (state === 'visible') acquireWakeLock();
});

onMounted(() => {
  engineStore.initEngine();
  acquireWakeLock();
});

onBeforeUnmount(() => {
  releaseWakeLock().catch(() => {});
});
</script>

<template>
  <div class="flex flex-col h-screen">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <GlobalContextMenu />
    <ReplacementChoiceDialog />
    <ToastStack />
    <WindowDragStrip />
  </div>
</template>

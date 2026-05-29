<script setup lang="ts">
import { useEngineStore } from '~/stores/engine-store';
import { onMounted, onBeforeUnmount } from 'vue';
import { useWakeLock, useDocumentVisibility } from '@vueuse/core';
import { watch } from 'vue';
import GlobalContextMenu from '~/components/GlobalContextMenu.vue';

const engineStore = useEngineStore();

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
  </div>
</template>

<script setup lang="ts">
import { useEngineStore } from '~/stores/engine-store';
import { onMounted } from 'vue';

const engineStore = useEngineStore();

onMounted(() => {
  engineStore.initEngine();
});
</script>

<template>
  <div class="flex flex-col h-screen">
    <AppHeader />
    <div class="flex-1 min-h-0">
      <NuxtPage />
    </div>
  </div>
</template>

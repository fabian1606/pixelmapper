<script setup lang="ts">
import { useEngineStore } from '~/stores/engine-store';
import { onMounted } from 'vue';
import GlobalContextMenu from '~/components/GlobalContextMenu.vue';

const engineStore = useEngineStore();

onMounted(() => {
  engineStore.initEngine();
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

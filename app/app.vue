<script setup lang="ts">
import { useEngineStore } from '~/stores/engine-store';
import { onMounted } from 'vue';

const engineStore = useEngineStore();

onMounted(() => {
  engineStore.initEngine();
});
</script>

<template>
  <div>
    <NuxtPage />
  </div>
</template>

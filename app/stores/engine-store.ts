import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Preset } from '~/utils/engine/preset-types';

export const useEngineStore = defineStore('engine', () => {
  const savedPresets = ref<Preset[]>([]);
  const selectedPresetId = ref<string | null>(null);

  // You can add other global engine state here (e.g. globalBpm, etc.)

  return {
    savedPresets,
    selectedPresetId
  };
});

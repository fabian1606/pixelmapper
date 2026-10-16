<script setup lang="ts">
/**
 * Host-owned speed of a modifier instance (ADR §6.3), last on the card.
 * Strength sits with the params (owner review R2), the distribution has its
 * own section; the plugin's params render in `ParamForm`.
 */
import type { ModifierInstance } from '~/utils/engine/types';
import SpeedControl from './SpeedControl.vue';
import { computed } from 'vue';
import { getManifest } from '~/utils/plugins/plugin-store';

const props = defineProps<{
  modifier: ModifierInstance;
}>();

/** "Speed · per step" when the manifest says what a tempo unit means. */
const speedLabel = computed(() => {
  const unit = getManifest(props.modifier.plugin)?.speedUnit;
  return unit ? `Speed · ${unit}` : 'Speed';
});

const emit = defineEmits<{
  /** One field changed (continuous edits are coalesced by the caller). */
  (e: 'update', key: keyof ModifierInstance, value: unknown): void;
  /** Several fields changed as one edit. */
  (e: 'update-properties', updates: Partial<ModifierInstance>, description: string): void;
  /** A continuous edit ended (commit one history step). */
  (e: 'drag-end', description: string): void;
  (e: 'dropdown-open-change', open: boolean): void;
}>();
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <SpeedControl
      :label="speedLabel"
      :disable-infinite="false"
      :model-value="modifier.speed"
      @update:model-value="emit('update', 'speed', $event); emit('drag-end', 'Update Modifier Speed')"
      @dropdown-open-change="v => emit('dropdown-open-change', v)"
    />
  </div>
</template>

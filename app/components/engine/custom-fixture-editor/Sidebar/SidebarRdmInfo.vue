<script setup lang="ts">
/**
 * "RDM" section of the general info sidebar (plan M4.7): the device-level
 * RDM manufacturer and model IDs used to recognize a discovered device as
 * this fixture. The per-mode personality index lives in the mode manager.
 */
import type { CustomFixtureFormState } from '~/utils/engine/custom-fixture-types';
import RdmIdInput from './RdmIdInput.vue';

defineProps<{
  formState: CustomFixtureFormState;
}>();

const emit = defineEmits<{
  (e: 'update:formState', value: Partial<CustomFixtureFormState>): void;
}>();
</script>

<template>
  <div class="space-y-2">
    <p class="text-[9px] uppercase tracking-wider font-bold text-muted-foreground/60 pt-3">RDM</p>
    <RdmIdInput
      label="Manufacturer"
      placeholder="e.g. 0x7FF0"
      :model-value="formState.rdmManufacturerId"
      @update:model-value="emit('update:formState', { rdmManufacturerId: $event })"
    />
    <RdmIdInput
      label="Model"
      placeholder="e.g. 0x0001"
      :model-value="formState.rdmModelId"
      @update:model-value="emit('update:formState', { rdmModelId: $event })"
    />
    <p class="text-[9px] text-muted-foreground/50 leading-relaxed">
      Optional. Used to recognize this fixture when it is discovered via RDM.
      <template v-if="formState.rdmSoftwareVersion">
        Software version: <span class="font-mono">{{ formState.rdmSoftwareVersion }}</span>
      </template>
    </p>
  </div>
</template>

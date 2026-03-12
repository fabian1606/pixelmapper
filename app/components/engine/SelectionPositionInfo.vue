<script setup lang="ts">
import type { Fixture } from '~/utils/engine/core/fixture';
import { STAGE_SIZE_METERS } from '~/utils/engine/constants';
import DraggableNumberInput from '@/components/ui/DraggableNumberInput.vue';
import { Label } from '@/components/ui/label';

const props = defineProps<{
  avgX: number; // Normalized 0-1
  avgY: number; // Normalized 0-1
  avgRotation: number;
}>();

const emit = defineEmits<{
  (e: 'change', axis: 'x' | 'y' | 'r', value: number): void;
  (e: 'live-change', axis: 'x' | 'y' | 'r', value: number): void;
}>();

/** Converts normalized 0-1 to meters */
const toMeters = (val: number) => Number((val * STAGE_SIZE_METERS).toFixed(3));

/** Converts meters back to 0-1 */
const fromMeters = (val: number) => val / STAGE_SIZE_METERS;
</script>

<template>
  <div class="space-y-2">
    <Label class="text-[9px] uppercase tracking-wider font-bold text-muted-foreground/60">Position (Meters)</Label>
    <div class="grid grid-cols-3 gap-3">
      <DraggableNumberInput 
        label="X" 
        unit="m"
        :step="0.01" 
        :model-value="toMeters(avgX)"
        @update:model-value="(val: number) => emit('live-change', 'x', fromMeters(val))"
        @change="(val: number) => emit('change', 'x', fromMeters(val))"
      />
      <DraggableNumberInput 
        label="Y" 
        unit="m"
        :step="0.01" 
        :model-value="toMeters(avgY)"
        @update:model-value="(val: number) => emit('live-change', 'y', fromMeters(val))"
        @change="(val: number) => emit('change', 'y', fromMeters(val))"
      />
      <DraggableNumberInput 
        label="Rot" 
        unit="°"
        :step="1" 
        :model-value="avgRotation"
        @update:model-value="(val: number) => emit('live-change', 'r', val)"
        @change="(val: number) => emit('change', 'r', val)"
      />
    </div>
  </div>
</template>

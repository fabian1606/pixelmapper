<script lang="ts">
export type PositionAxis = 'x' | 'y' | 'z' | 'r' | 'tx' | 'rz';
</script>

<script setup lang="ts">
import { STAGE_SIZE_METERS } from '~/utils/engine/constants';
import Replaceable from '~/components/extension-host/Replaceable.vue';
import { Label } from '@/components/ui/label';

const props = defineProps<{
  avgX: number; // Normalized 0-1
  avgY: number; // Normalized 0-1
  avgZ: number; // Normalized 0-1 (height above floor)
  avgRotation: number;
  avgTiltX: number;
  avgRollZ: number;
}>();

const emit = defineEmits<{
  (e: 'change', axis: PositionAxis, value: number): void;
  (e: 'live-change', axis: PositionAxis, value: number): void;
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
      <Replaceable name="pm.numberInput"
        label="X"
        :step="0.01"
        :model-value="toMeters(avgX)"
        @update:model-value="(val: number) => emit('live-change', 'x', fromMeters(val))"
        @commit="(val: number) => emit('change', 'x', fromMeters(val))"
      />
      <Replaceable name="pm.numberInput"
        label="Y"
        :step="0.01"
        :model-value="toMeters(avgY)"
        @update:model-value="(val: number) => emit('live-change', 'y', fromMeters(val))"
        @commit="(val: number) => emit('change', 'y', fromMeters(val))"
      />
      <Replaceable name="pm.numberInput"
        label="Z"
        :step="0.01"
        :model-value="toMeters(avgZ)"
        @update:model-value="(val: number) => emit('live-change', 'z', fromMeters(val))"
        @commit="(val: number) => emit('change', 'z', fromMeters(val))"
      />
    </div>
    <div class="grid grid-cols-3 gap-3">
      <Replaceable name="pm.numberInput"
        label="Rot"
        :step="1"
        :model-value="avgRotation"
        @update:model-value="(val: number) => emit('live-change', 'r', val)"
        @commit="(val: number) => emit('change', 'r', val)"
      />
      <Replaceable name="pm.numberInput"
        label="Tilt"
        :step="1"
        :model-value="avgTiltX"
        @update:model-value="(val: number) => emit('live-change', 'tx', val)"
        @commit="(val: number) => emit('change', 'tx', val)"
      />
      <Replaceable name="pm.numberInput"
        label="Roll"
        :step="1"
        :model-value="avgRollZ"
        @update:model-value="(val: number) => emit('live-change', 'rz', val)"
        @commit="(val: number) => emit('change', 'rz', val)"
      />
    </div>
  </div>
</template>

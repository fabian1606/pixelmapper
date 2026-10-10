<script setup lang="ts">
/**
 * Host-owned fields of a modifier instance (ADR §6.3): strength and speed.
 * The distribution has its own section; the plugin's params render in
 * `ParamForm`.
 */
import type { ModifierInstance } from '~/utils/engine/types';
import { Label } from '@/components/ui/label';
import Replaceable from '~/components/extension-host/Replaceable.vue';
import SpeedControl from './SpeedControl.vue';

defineProps<{
  modifier: ModifierInstance;
}>();

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
  <div class="grid grid-cols-2 gap-x-4 gap-y-3">
    <div class="space-y-1.5">
      <Label class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Strength</Label>
      <!-- Stored 0–1, shown as percent. -->
      <Replaceable
        name="pm.numberInput"
        :model-value="Math.round(modifier.strength * 100)"
        unit="%"
        :min="0"
        :max="100"
        @update:model-value="(v: number) => emit('update', 'strength', Math.max(0, Math.min(100, v)) / 100)"
        @commit="emit('drag-end', 'Update Modifier Strength')"
      />
    </div>
    <div class="space-y-1.5 flex flex-col justify-start">
      <SpeedControl
        label="Speed"
        :disable-infinite="false"
        :model-value="modifier.speed"
        @update:model-value="emit('update', 'speed', $event); emit('drag-end', 'Update Modifier Speed')"
        @dropdown-open-change="v => emit('dropdown-open-change', v)"
      />
    </div>
  </div>
</template>

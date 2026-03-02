<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next';
import SpeedControl from './SpeedControl.vue';
import type { ChannelChaserConfig, SpeedConfig } from '~/utils/engine/types';

defineProps<{
  activeChaserConfig: ChannelChaserConfig;
}>();

const emit = defineEmits<{
  (e: 'update-timing', key: 'stepDuration' | 'fadeDuration', value: SpeedConfig): void;
  (e: 'set-active-step', index: number): void;
  (e: 'add-step'): void;
  (e: 'delete-active-step'): void;
  (e: 'dropdown-open-change', open: boolean): void;
}>();
</script>

<template>
  <div class="space-y-4">
    
    <!-- Timing rows -->
    <div v-if="activeChaserConfig?.stepsCount > 1" class="flex items-start gap-4">
      <SpeedControl 
        label="Step Length"
        :model-value="activeChaserConfig.stepDuration"
        @update:model-value="v => emit('update-timing', 'stepDuration', v)"
        @dropdown-open-change="v => emit('dropdown-open-change', v)"
      />
      <SpeedControl 
        label="Fade Length"
        :model-value="activeChaserConfig.fadeDuration"
        :disable-offset="true"
        @update:model-value="v => emit('update-timing', 'fadeDuration', v)"
        @dropdown-open-change="v => emit('dropdown-open-change', v)"
      />
    </div>

    <!-- Steps Row -->
    <div class="flex items-center justify-between pt-1">
      <!-- Steps Selection list -->
      <div class="flex gap-1.5 overflow-x-auto flex-1 items-center pr-4">
        <button
          v-for="stepIndex in (activeChaserConfig?.stepsCount || 1)"
          :key="stepIndex"
          @click="emit('set-active-step', stepIndex - 1)"
          class="w-10 h-8 rounded-md text-sm font-medium flex items-center justify-center transition-all shrink-0"
          :class="activeChaserConfig?.activeEditStep === stepIndex - 1 ? 'bg-accent border-2 border-primary text-primary' : 'bg-muted border-2 border-transparent hover:border-border text-foreground'"
        >
          {{ stepIndex }}
        </button>
        <button
          @click="emit('add-step')"
          class="w-8 h-8 rounded-md text-sm font-medium flex items-center justify-center bg-transparent border-2 border-dashed border-border hover:bg-muted/50 text-muted-foreground shrink-0"
          title="Add Step"
        >
          +
        </button>
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-1.5 shrink-0">
        <button 
          v-if="activeChaserConfig?.stepsCount > 1"
          @click="emit('delete-active-step')" 
          class="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          title="Delete Active Step"
        >
          <Trash2 class="w-4 h-4" />
        </button>
      </div>
    </div>

  </div>
</template>

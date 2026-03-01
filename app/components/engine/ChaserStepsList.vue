<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next';
import type { ChannelChaserConfig } from '~/utils/engine/types';

defineProps<{
  activeChaserConfig: ChannelChaserConfig;
}>();

const emit = defineEmits<{
  (e: 'update-timing', key: 'stepDurationMs' | 'fadeDurationMs', value: number): void;
  (e: 'set-active-step', index: number): void;
  (e: 'add-step'): void;
  (e: 'delete-active-step'): void;
}>();
</script>

<template>
  <div class="space-y-4">
    
    <!-- Timing rows -->
    <div v-if="activeChaserConfig?.stepsCount > 1" class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-xs text-muted-foreground font-medium uppercase tracking-wider">Speed (ms)</span>
        <input 
          type="number" 
          :value="activeChaserConfig.stepDurationMs" 
          @input="e => emit('update-timing', 'stepDurationMs', Number((e.target as HTMLInputElement).value))" 
          class="w-24 h-7 text-xs bg-background border border-border rounded px-2 focus:ring-1 focus:ring-primary outline-none transition-all text-right" 
        />
      </div>
      <div class="flex items-center justify-between">
        <span class="text-xs text-muted-foreground font-medium uppercase tracking-wider">Fade (ms)</span>
        <input 
          type="number" 
          :value="activeChaserConfig.fadeDurationMs" 
          @input="e => emit('update-timing', 'fadeDurationMs', Number((e.target as HTMLInputElement).value))" 
          class="w-24 h-7 text-xs bg-background border border-border rounded px-2 focus:ring-1 focus:ring-primary outline-none transition-all text-right" 
        />
      </div>
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

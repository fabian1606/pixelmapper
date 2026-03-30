<script setup lang="ts">
import { Button } from '@/components/ui/button';

defineProps<{
  steps: readonly { id: string; label: string }[];
  currentStepIdx: number;
}>();

const emit = defineEmits<{
  (e: 'update:currentStepIdx', val: number): void;
}>();
</script>

<template>
  <div class="shrink-0 border-b bg-muted/20 px-6 py-4 flex items-center">
    <h2 class="text-base font-bold tracking-tight shrink-0 flex-1">Create Custom Fixture</h2>
    
    <div class="flex items-center bg-muted/50 p-1 rounded-lg border border-border/50">
      <button 
        v-for="(step, idx) in steps" 
        :key="step.id"
        class="px-4 py-1.5 text-[13px] font-medium rounded-md transition-all duration-200 ease-out"
        :class="currentStepIdx === idx ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'"
        @click="emit('update:currentStepIdx', idx)"
      >
        {{ step.label }}
      </button>
    </div>
    
    <div class="flex-1" />
  </div>
</template>

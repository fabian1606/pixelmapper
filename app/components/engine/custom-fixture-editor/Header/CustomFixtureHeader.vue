<script setup lang="ts">
import CustomFixtureStepper from './CustomFixtureStepper.vue';

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
    
    <CustomFixtureStepper 
      :steps="steps" 
      :current-step-idx="currentStepIdx"
      @update:current-step-idx="emit('update:currentStepIdx', $event)" 
    />
    
    <div class="flex-1" />
  </div>
</template>

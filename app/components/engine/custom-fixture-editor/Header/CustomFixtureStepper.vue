<script setup lang="ts">
import { CheckCircle2 } from 'lucide-vue-next';

defineProps<{
  steps: readonly { id: string; label: string }[];
  currentStepIdx: number;
}>();

const emit = defineEmits<{
  (e: 'update:currentStepIdx', val: number): void;
}>();
</script>

<template>
  <div class="flex items-center gap-0 flex-1 justify-center">
    <template v-for="(step, i) in steps" :key="step.id">
      <!-- Connector line -->
      <div v-if="i > 0" class="h-px w-10 shrink-0 transition-colors"
        :class="i <= currentStepIdx ? 'bg-primary' : 'bg-border'" />

      <!-- Step -->
      <button
        class="flex items-center gap-2 transition-colors group"
        :class="i > currentStepIdx ? 'cursor-default' : 'cursor-pointer'"
        :disabled="i > currentStepIdx"
        @click="emit('update:currentStepIdx', i)"
      >
        <!-- Circle -->
        <span
          class="size-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold transition-colors ring-2"
          :class="i < currentStepIdx
            ? 'bg-primary ring-primary text-primary-foreground'
            : i === currentStepIdx
              ? 'bg-background ring-primary text-primary'
              : 'bg-background ring-border text-muted-foreground/40'"
        >
          <CheckCircle2 v-if="i < currentStepIdx" class="size-3.5" />
          <span v-else>{{ i + 1 }}</span>
        </span>
        <!-- Label -->
        <span class="text-xs font-medium transition-colors"
          :class="i === currentStepIdx
            ? 'text-foreground'
            : i < currentStepIdx
              ? 'text-muted-foreground group-hover:text-foreground'
              : 'text-muted-foreground/40'"
        >{{ step.label }}</span>
      </button>
    </template>
  </div>
</template>

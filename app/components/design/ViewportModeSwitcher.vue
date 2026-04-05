<script setup lang="ts">
import { SquareChartGantt, SquareDashedMousePointer, Box } from 'lucide-vue-next';

export type ViewportMode = 'raw' | '2d' | '3d';

// Modern Vue 3.4+ macro for handling v-model props and emits automatically
const modelValue = defineModel<ViewportMode>({ default: '2d' });

const modes: { id: ViewportMode; label: string; icon: typeof SquareChartGantt; disabled?: boolean }[] = [
  { id: 'raw', label: 'Raw', icon: SquareChartGantt },
  { id: '2d',     label: '2D',     icon: SquareDashedMousePointer },
  { id: '3d',     label: '3D',     icon: Box, disabled: true },
];
</script>

<template>
  <div
    class="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-auto"
    style="pointer-events: none;"
  >
    <div
      class="flex items-center bg-background/90 backdrop-blur-sm border border-border/60 rounded-full shadow-lg p-1 gap-0.5"
      style="pointer-events: auto;"
    >
      <button
        v-for="mode in modes"
        :key="mode.id"
        :disabled="mode.disabled"
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-150"
        :class="[
          modelValue === mode.id
            ? 'bg-accent text-primary'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
          mode.disabled ? 'opacity-35 cursor-not-allowed' : 'cursor-pointer',
        ]"
        :title="mode.disabled ? 'Bald verfügbar' : undefined"
        @click="!mode.disabled && (modelValue = mode.id)"
      >
        <component :is="mode.icon" class="w-3.5 h-3.5 shrink-0" />
        {{ mode.label }}
      </button>
    </div>
  </div>
</template>

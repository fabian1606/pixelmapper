<script setup lang="ts">
import { computed, type Component } from 'vue';

const props = defineProps<{
  type: string;
  role: string;
  colorValue: string;
  rawValue: number;
  channelIcon: Component;
  activeSlotColor: string | null;
  isDragging: boolean;
}>();

const emit = defineEmits<{
  (e: 'dragstart', event: MouseEvent): void;
}>();

// Visual box style
const containerStyle = computed(() => {
  if (props.role === 'COLOR') {
    return { boxShadow: `inset 0 0 0 2px ${props.colorValue}80` };
  }
  if (props.role === 'DIMMER') {
    return { boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.3)' };
  }
  return { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)' };
});

const rectStyle = computed(() => {
  if (props.type === 'COLOR_WHEEL') {
    // Show the actual current slot colour, or fall back to conic gradient
    if (props.activeSlotColor) {
      return { backgroundColor: props.activeSlotColor };
    }
    return {
      background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
      opacity: 0.8,
    };
  }
  if (props.role === 'COLOR') {
    return { backgroundColor: props.colorValue, opacity: props.rawValue / 255 };
  }
  if (props.role === 'DIMMER') {
    return { backgroundColor: '#ffffff', opacity: props.rawValue / 255 };
  }
  return {};
});
</script>

<template>
  <div
    class="relative w-12 h-12 flex-shrink-0 rounded-xl overflow-hidden flex items-center justify-center cursor-ew-resize"
    :class="role !== 'NONE' ? 'bg-white/5' : 'bg-muted/40 text-muted-foreground'"
    :style="containerStyle"
    @mousedown="$emit('dragstart', $event)"
  >
    <!-- Inset hover ring -->
    <div
      class="absolute inset-0 rounded-xl pointer-events-none hover-inset-ring"
      :class="isDragging ? 'dragging-ring' : ''"
    />

    <!-- Color / dimmer / color-wheel fill -->
    <div
      v-if="role !== 'NONE'"
      class="absolute inset-0 transition-all duration-150"
      :style="rectStyle"
    />

    <!-- Icon overlay for non-color channels or color wheels -->
    <component
      :is="channelIcon"
      v-if="type === 'COLOR_WHEEL' || role === 'NONE'"
      class="w-6 h-6 relative z-10 drop-shadow"
      :style="type === 'COLOR_WHEEL' ? { color: activeSlotColor ? 'white' : 'rgba(255,255,255,0.7)' } : undefined"
    />
  </div>
</template>

<style scoped>
.hover-inset-ring:hover {
  box-shadow: inset 0 0 0 1.5px hsl(var(--primary) / 0.5);
}
.dragging-ring {
  box-shadow: inset 0 0 0 1.5px hsl(var(--primary) / 0.8) !important;
}
</style>

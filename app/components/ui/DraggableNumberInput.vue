<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useVModel } from '@vueuse/core';
import { cn } from '@/lib/utils';

interface Props {
  modelValue: number;
  label?: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  sensitivity?: number;
  class?: string;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  step: 1,
  sensitivity: 1,
  disabled: false
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void;
  (e: 'change', value: number): void;
  (e: 'drag-start'): void;
}>();

const modelValue = useVModel(props, 'modelValue', emit, {
  passive: true,
});

const isDragging = ref(false);
const startValue = ref(0);
const dragStartX = ref(0);

// Calculate precision based on step (e.g., 0.001 -> 3)
const precision = computed(() => {
  const stepStr = props.step.toString();
  if (stepStr.includes('.')) {
    return stepStr.split('.')[1]?.length ?? 0;
  }
  return 0;
});

function handleMouseDown(e: MouseEvent) {
  if (props.disabled) return;
  isDragging.value = true;
  startValue.value = Number(modelValue.value ?? 0);
  dragStartX.value = e.clientX;
  
  emit('drag-start');
  
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
  
  // Prevent text selection
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'ew-resize';
}

function handleMouseMove(e: MouseEvent) {
  if (!isDragging.value) return;
  
  const deltaX = e.clientX - dragStartX.value;
  // sensitivity adjustment: 5px movement = 1 step
  const change = (deltaX / 5) * props.step * props.sensitivity;
  
  let newValue = startValue.value + change;
  
  // Apply constraints
  if (props.min !== undefined) newValue = Math.max(props.min, newValue);
  if (props.max !== undefined) newValue = Math.min(props.max, newValue);
  
  // Fix precision
  modelValue.value = Number(newValue.toFixed(precision.value));
}

function handleMouseUp() {
  if (!isDragging.value) return;
  isDragging.value = false;
  
  window.removeEventListener('mousemove', handleMouseMove);
  window.removeEventListener('mouseup', handleMouseUp);
  
  document.body.style.userSelect = '';
  document.body.style.cursor = '';
  
  emit('change', modelValue.value);
}

function handleInputChange(e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value);
  if (!isNaN(val)) {
    modelValue.value = val;
  }
}

function handleInputCommit(e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value);
  if (!isNaN(val)) {
    emit('change', val);
  }
}

onUnmounted(() => {
  window.removeEventListener('mousemove', handleMouseMove);
  window.removeEventListener('mouseup', handleMouseUp);
});
</script>

<template>
  <div 
    :class="cn(
      'group relative flex items-center h-8 bg-background border border-border rounded-md overflow-hidden transition-all duration-200 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring',
      isDragging && 'border-primary/50 bg-primary/5 ring-1 ring-primary/20',
      disabled && 'opacity-50 cursor-not-allowed',
      props.class
    )"
  >
    <!-- Prefix / Label -->
    <div 
      v-if="label"
      @mousedown="handleMouseDown"
      class="flex items-center justify-center h-full px-2 bg-muted/30 border-r border-border cursor-ew-resize select-none hover:bg-muted/50 transition-colors shrink-0"
    >
      <span class="text-[9px] font-bold text-muted-foreground/70 uppercase tracking-tighter">{{ label }}</span>
    </div>

    <!-- Input -->
    <input
      type="number"
      :step="step"
      :min="min"
      :max="max"
      :value="modelValue"
      :disabled="disabled"
      @input="handleInputChange"
      @blur="handleInputCommit"
      @keyup.enter="handleInputCommit"
      class="w-full h-full bg-transparent px-2 text-[11px] font-medium outline-none border-none tabular-nums"
    />

    <!-- Suffix / Unit -->
    <div 
      v-if="unit"
      @mousedown="handleMouseDown"
      class="flex items-center justify-center h-full px-2 bg-muted/10 cursor-ew-resize select-none border-l border-border/50 hover:bg-muted/30 transition-colors shrink-0"
    >
      <span class="text-[9px] font-medium text-muted-foreground/50 lowercase">{{ unit }}</span>
    </div>

  </div>
</template>

<style scoped>
/* Hide spin buttons for Chrome, Safari, Edge, Opera */
input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* Hide spin buttons for Firefox */
input[type=number] {
  -moz-appearance: textfield !important;
  appearance: textfield !important;
  margin: 0;
}
</style>

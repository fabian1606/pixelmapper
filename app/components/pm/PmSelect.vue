<script setup lang="ts">
/**
 * Core default of `pm.select` (ADR §5.4): enum choice. Renders a segmented
 * control for few options (`auto` ≤ 4) and a dropdown otherwise. A choice is
 * a discrete edit: `scrubStart`/`scrubEnd` bracket it as one undo step.
 */
import { computed } from 'vue';
import type { SelectEmits, SelectProps } from '@pixelmapper/extension-api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const props = withDefaults(defineProps<SelectProps>(), { disabled: false, variant: 'auto', size: 'md' });
const emit = defineEmits<SelectEmits>();

const segmented = computed(() => props.variant === 'segmented' || (props.variant === 'auto' && props.options.length <= 4));

/** Emits a discrete change. */
function choose(value: string) {
  if (value === props.modelValue) return;
  emit('scrubStart');
  emit('update:modelValue', value);
  emit('scrubEnd');
}
</script>

<template>
  <div class="flex flex-col gap-1" :class="disabled && 'opacity-50 pointer-events-none'">
    <div v-if="label" class="text-xs text-muted-foreground">{{ label }}</div>
    <div v-if="segmented" class="flex rounded-md border border-border overflow-hidden" role="radiogroup" :aria-label="label">
      <button
        v-for="opt in options"
        :key="opt.value"
        type="button"
        role="radio"
        :aria-checked="opt.value === modelValue"
        class="flex-1 px-2 py-1 text-xs transition-colors border-r border-border last:border-r-0"
        :class="opt.value === modelValue ? 'bg-primary text-primary-foreground' : 'hover:bg-accent text-muted-foreground'"
        :disabled="disabled"
        @click="choose(opt.value)"
      >
        {{ opt.label }}
      </button>
    </div>
    <Select v-else :model-value="modelValue" :disabled="disabled" @update:model-value="v => choose(String(v))">
      <SelectTrigger class="h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="opt in options" :key="opt.value" :value="opt.value" class="text-xs">{{ opt.label }}</SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>

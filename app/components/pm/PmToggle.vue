<script setup lang="ts">
/**
 * Core default of `pm.toggle` (ADR §5.4): boolean switch. A flip is a
 * discrete edit bracketed by `scrubStart`/`scrubEnd`.
 */
import type { ToggleEmits, ToggleProps } from '@pixelmapper/extension-api';

const props = withDefaults(defineProps<ToggleProps>(), { disabled: false, size: 'md' });
const emit = defineEmits<ToggleEmits>();

/** Flips the value. */
function flip() {
  if (props.disabled) return;
  emit('scrubStart');
  emit('update:modelValue', !props.modelValue);
  emit('scrubEnd');
}
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label"
    :disabled="disabled"
    class="inline-flex items-center gap-2 text-xs disabled:opacity-50"
    @click="flip"
  >
    <span
      class="relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors"
      :class="modelValue ? 'bg-primary' : 'bg-muted'"
    >
      <span
        class="absolute top-0.5 size-3 rounded-full bg-background shadow transition-transform"
        :class="modelValue ? 'translate-x-3.5' : 'translate-x-0.5'"
      />
    </span>
    <span v-if="label" class="text-muted-foreground">{{ label }}</span>
  </button>
</template>

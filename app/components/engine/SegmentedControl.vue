<script setup lang="ts" generic="T extends string | number">
/**
 * Segmented button group (one choice of a few): used by the Distribution
 * section, the tempo row and segmented enum params. Keyboard: buttons are
 * focusable and expose `aria-pressed`. Labels truncate instead of widening
 * the panel.
 */
import type { Component } from 'vue';

/** One segment. */
export interface Segment<V> {
  value: V;
  label?: string;
  icon?: Component;
  title?: string;
  disabled?: boolean;
}

defineProps<{
  options: Segment<T>[];
  modelValue: T | null;
  /** Accessible name of the group. */
  ariaLabel?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: T];
}>();
</script>

<template>
  <div class="flex min-w-0 rounded-md border border-border/60 bg-muted/20 p-0.5 gap-0.5" role="group" :aria-label="ariaLabel">
    <button
      v-for="o in options"
      :key="String(o.value)"
      type="button"
      class="flex min-w-0 flex-1 items-center justify-center gap-1 rounded px-1.5 h-6 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
      :class="modelValue === o.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
      :aria-pressed="modelValue === o.value"
      :title="o.title ?? o.label"
      :disabled="disabled || o.disabled"
      :data-value="o.value"
      @click.stop="emit('update:modelValue', o.value)"
    >
      <component :is="o.icon" v-if="o.icon" class="h-3.5 w-3.5 shrink-0" />
      <span v-if="o.label" class="truncate">{{ o.label }}</span>
    </button>
  </div>
</template>

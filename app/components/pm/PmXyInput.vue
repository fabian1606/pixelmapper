<script setup lang="ts">
/**
 * Core default of `pm.xyInput` (ADR §5.4, D14): minimal 2D input — two
 * faders for x and y (normalized 0–1). The pan-tilt extension replaces this
 * with a pad.
 */
import type { XyInputEmits, XyInputProps } from '@pixelmapper/extension-api';
import { useReplaceable } from '~/composables/extensions/use-replaceable';

const props = withDefaults(defineProps<XyInputProps>(), { disabled: false, size: 'md' });
/** Composes the active `pm.fader` so replacing it changes this input too. */
const Fader = useReplaceable('pm.fader');

const emit = defineEmits<XyInputEmits>();

/** Updates one axis. */
function setAxis(axis: 'x' | 'y', v: number) {
  emit('update:modelValue', { ...props.modelValue, [axis]: v });
}
</script>

<template>
  <div class="flex flex-col gap-1.5" :class="disabled && 'opacity-50 pointer-events-none'">
    <div v-if="label" class="text-xs text-muted-foreground">{{ label }}</div>
    <component
      :is="Fader"
      :model-value="modelValue.x"
      :label="axisLabels?.[0] ?? 'X'"
      unit="%"
      :size="size"
      :disabled="disabled"
      @update:model-value="(v: number) => setAxis('x', v)"
      @scrub-start="emit('scrubStart')"
      @scrub-end="emit('scrubEnd')"
    />
    <component
      :is="Fader"
      :model-value="modelValue.y"
      :label="axisLabels?.[1] ?? 'Y'"
      unit="%"
      :size="size"
      :disabled="disabled"
      @update:model-value="(v: number) => setAxis('y', v)"
      @scrub-start="emit('scrubStart')"
      @scrub-end="emit('scrubEnd')"
    />
  </div>
</template>

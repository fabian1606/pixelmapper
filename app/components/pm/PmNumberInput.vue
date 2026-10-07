<script setup lang="ts">
/**
 * Core default of `pm.numberInput` (ADR §5.4): wraps the draggable numeric
 * field. Maps its `drag-start` → `scrubStart` and its committing `change`
 * → `scrubEnd` + `commit`. Extra attributes (e.g. `sensitivity`, `class`)
 * fall through to the wrapped field.
 */
import type { NumberInputEmits, NumberInputProps } from '@pixelmapper/extension-api';
import DraggableNumberInput from '@/components/ui/DraggableNumberInput.vue';

const props = withDefaults(defineProps<NumberInputProps>(), { disabled: false });
const emit = defineEmits<NumberInputEmits>();

/** Committed edit: closes a drag (if any) and reports the final value. */
function onChange(v: number) {
  emit('scrubEnd');
  emit('commit', v);
}
</script>

<template>
  <DraggableNumberInput
    :model-value="props.modelValue"
    :label="label"
    :unit="unit"
    :min="min"
    :max="max"
    :step="step"
    :disabled="disabled"
    @update:model-value="(v: number) => emit('update:modelValue', v)"
    @drag-start="emit('scrubStart')"
    @change="onChange"
  />
</template>

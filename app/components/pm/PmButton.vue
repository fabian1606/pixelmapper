<script setup lang="ts">
/**
 * Core default of `pm.button` (ADR §5.4): a live/trigger button (not the
 * shadcn button). `momentary`: active while held; `toggle`: flips on press.
 * Emits `press`/`release` for the physical interaction and
 * `update:modelValue` for the resulting active state. The default slot can
 * add decorations (e.g. a flash badge).
 */
import { ref } from 'vue';
import type { TriggerButtonEmits, TriggerButtonProps } from '@pixelmapper/extension-api';

const props = withDefaults(defineProps<TriggerButtonProps>(), { disabled: false, mode: 'momentary', size: 'md' });
const emit = defineEmits<TriggerButtonEmits>();

/** Whether the pointer is currently held on the button. */
const held = ref(false);

function onDown(e: PointerEvent) {
  if (props.disabled) return;
  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  held.value = true;
  emit('press');
  emit('update:modelValue', props.mode === 'toggle' ? !props.modelValue : true);
}

function onUp() {
  if (!held.value) return;
  held.value = false;
  emit('release');
  if (props.mode === 'momentary') emit('update:modelValue', false);
}
</script>

<template>
  <button
    type="button"
    class="w-full h-full rounded flex items-center justify-center text-sm font-medium transition-all select-none border relative cursor-pointer"
    :class="modelValue ? 'brightness-150 scale-95' : 'brightness-100 scale-100'"
    :style="{ backgroundColor: color ?? '#334155', borderColor: `${color ?? '#334155'}88`, color: '#fff' }"
    :disabled="disabled"
    :aria-pressed="modelValue"
    @pointerdown="onDown"
    @pointerup="onUp"
    @pointerleave="onUp"
    @pointercancel="onUp"
  >
    <span class="truncate px-2">{{ label }}</span>
    <slot />
  </button>
</template>

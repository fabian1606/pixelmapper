<script setup lang="ts">
import { ref, nextTick } from 'vue';

const props = defineProps<{
  value: number;
  min?: number;
  max?: number;
  suffix?: string;
}>();

const emit = defineEmits<{
  (e: 'commit', value: number): void;
}>();

const editing = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);
const draft = ref('');

async function startEdit() {
  draft.value = String(props.value);
  editing.value = true;
  await nextTick();
  inputRef.value?.select();
}

function commit() {
  editing.value = false;
  const parsed = parseFloat(draft.value);
  if (isNaN(parsed)) return;
  const clamped = Math.round(
    props.min !== undefined && props.max !== undefined
      ? Math.max(props.min, Math.min(props.max, parsed))
      : parsed
  );
  emit('commit', clamped);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') commit();
  if (e.key === 'Escape') editing.value = false;
}
</script>

<template>
  <span
    v-if="!editing"
    class="text-xs text-muted-foreground w-8 text-right cursor-text hover:text-foreground transition-colors select-none"
    @click="startEdit"
  >{{ value }}{{ suffix }}</span>
  <input
    v-else
    ref="inputRef"
    v-model="draft"
    type="number"
    :min="min"
    :max="max"
    class="w-8 text-xs text-right bg-transparent border-b border-primary outline-none text-foreground [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
    @blur="commit"
    @keydown="onKeydown"
  />
</template>

<script setup lang="ts">
/**
 * RDM personality index of the active mode (plan M4.7): the 1-based
 * personality number a device reports via RDM for this DMX mode. Optional —
 * an empty field means "unknown" and is omitted on save.
 *
 * Mount with `:key="mode.id"` so switching modes resets invalid local text.
 */
import { ref, watch } from 'vue';
import { parseRdmPersonalityIndex } from '../../rdm-id';

const props = defineProps<{
  /** Current index; `undefined` = not set. */
  modelValue: number | undefined;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: number | undefined): void;
}>();

// Local text so invalid input stays visible without being emitted.
const text = ref(props.modelValue ? String(props.modelValue) : '');
const isInvalid = ref(false);

// External changes (load / import) refresh the text.
watch(() => props.modelValue, (value) => {
  text.value = value ? String(value) : '';
  isInvalid.value = false;
});

/** Parses each keystroke; emits only valid values (`undefined` when cleared). */
function onInput(event: Event) {
  text.value = (event.target as HTMLInputElement).value;
  const parsed = parseRdmPersonalityIndex(text.value);
  isInvalid.value = parsed === undefined;
  if (parsed === undefined) return;
  const next = parsed ?? undefined;
  if (next !== props.modelValue) emit('update:modelValue', next);
}
</script>

<template>
  <div class="flex items-center gap-2 border-b border-border/50 bg-background px-3 py-1.5 shrink-0">
    <p class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">RDM Personality</p>
    <input
      type="text"
      inputmode="numeric"
      autocomplete="off"
      :value="text"
      placeholder="—"
      aria-label="RDM personality index of this mode"
      :aria-invalid="isInvalid || undefined"
      class="h-6 w-14 rounded-md border bg-background px-2 text-[11px] font-mono font-medium outline-none transition-colors focus:ring-1"
      :class="isInvalid ? 'border-destructive focus:ring-destructive' : 'border-border focus:border-ring focus:ring-ring'"
      @input="onInput"
    />
    <p class="text-[10px]" :class="isInvalid ? 'text-destructive' : 'text-muted-foreground/50'">
      {{ isInvalid ? 'Positive whole number' : 'Optional' }}
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * Text input for a 16-bit RDM ID (manufacturer or model ID).
 *
 * Accepts decimal (`32752`) or hex (`0x7FF0`), emits the parsed number while
 * typing (or `null` when cleared), and shows the value as hex once the field
 * loses focus. Invalid input is kept visible with an error hint and is never
 * emitted, so the form keeps its last valid value.
 */
import { ref, watch } from 'vue';
import { formatRdmId, parseRdmId } from '../rdm-id';

const props = defineProps<{
  /** Current ID; `null` = not set. */
  modelValue: number | null;
  /** Short label in the left zone (e.g. "Manufacturer"). */
  label: string;
  /** Placeholder shown while empty. */
  placeholder?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: number | null): void;
}>();

// Local text so partially typed input ("0x7F") is not reformatted mid-typing.
const text = ref(formatRdmId(props.modelValue));
const isFocused = ref(false);
const isInvalid = ref(false);

// External changes (load / import) refresh the text unless the user is typing.
watch(() => props.modelValue, (value) => {
  if (isFocused.value) return;
  text.value = formatRdmId(value);
  isInvalid.value = false;
});

/** Parses each keystroke; emits only valid values. */
function onInput(event: Event) {
  text.value = (event.target as HTMLInputElement).value;
  const parsed = parseRdmId(text.value);
  isInvalid.value = parsed === undefined;
  if (parsed !== undefined && parsed !== props.modelValue) emit('update:modelValue', parsed);
}

/** On blur: show the stored value as hex, unless the input is invalid. */
function onBlur() {
  isFocused.value = false;
  if (!isInvalid.value) text.value = formatRdmId(props.modelValue);
}
</script>

<template>
  <div class="space-y-1">
    <div
      class="flex items-center h-8 bg-background border rounded-md overflow-hidden transition-all duration-200 focus-within:ring-1"
      :class="isInvalid
        ? 'border-destructive focus-within:border-destructive focus-within:ring-destructive'
        : 'border-border focus-within:border-ring focus-within:ring-ring'"
    >
      <div class="flex items-center justify-center h-full px-2 bg-muted/30 border-r border-border select-none shrink-0">
        <span class="text-[9px] font-bold text-muted-foreground/70 uppercase tracking-tighter">{{ label }}</span>
      </div>
      <input
        type="text"
        inputmode="text"
        spellcheck="false"
        autocomplete="off"
        :value="text"
        :placeholder="placeholder"
        :aria-invalid="isInvalid || undefined"
        :aria-label="`RDM ${label} ID`"
        class="w-full h-full bg-transparent px-2 text-[11px] font-mono font-medium outline-none border-none placeholder:text-muted-foreground/40"
        @focus="isFocused = true"
        @input="onInput"
        @blur="onBlur"
        @keyup.enter="($event.target as HTMLInputElement).blur()"
      />
    </div>
    <p v-if="isInvalid" class="text-[10px] text-destructive">
      Enter 0–65535 or hex like 0x7FF0.
    </p>
  </div>
</template>

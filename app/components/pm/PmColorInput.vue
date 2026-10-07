<script setup lang="ts">
/**
 * Core default of `pm.colorInput` (ADR §5.4, D14): minimal RGB editor —
 * three faders plus a hex field. Value is linear RGB with components 0–1.
 * The color-picker extension replaces this with a full picker.
 */
import { computed, ref, watch } from 'vue';
import type { ColorInputEmits, ColorInputProps, ColorSwatch, RgbColor } from '@pixelmapper/extension-api';
import { useReplaceable } from '~/composables/extensions/use-replaceable';

const props = withDefaults(defineProps<ColorInputProps>(), { disabled: false, size: 'md' });
/** Composes the active `pm.fader` so replacing it changes this input too. */
const Fader = useReplaceable('pm.fader');

const emit = defineEmits<ColorInputEmits>();

/** Components in fader order with their track colors. */
const CHANNELS: { key: keyof RgbColor; label: string; color: string }[] = [
  { key: 'r', label: 'R', color: '#ef4444' },
  { key: 'g', label: 'G', color: '#22c55e' },
  { key: 'b', label: 'B', color: '#3b82f6' },
];

/** 0–1 → two hex digits. */
const hex2 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');

const hex = computed(() => `#${hex2(props.modelValue.r)}${hex2(props.modelValue.g)}${hex2(props.modelValue.b)}`);

/** Editable hex text; resynced when the value changes externally. */
const hexText = ref(hex.value);
watch(hex, (h) => { hexText.value = h; });

function setChannel(key: keyof RgbColor, v: number) {
  emit('update:modelValue', { ...props.modelValue, [key]: v });
}

/** CSS color of a swatch. */
const swatchCss = (s: ColorSwatch) => `rgb(${s.color.r * 255}, ${s.color.g * 255}, ${s.color.b * 255})`;

/** Picks a swatch as one undo step. */
function pickSwatch(s: ColorSwatch) {
  emit('scrubStart');
  emit('update:modelValue', { ...s.color });
  emit('scrubEnd');
}

/** Parses `#rrggbb` / `rrggbb` / `#rgb` and commits as one undo step. */
function commitHex() {
  const m = hexText.value.trim().replace(/^#/, '');
  const full = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
  if (!/^[0-9a-f]{6}$/i.test(full)) {
    hexText.value = hex.value;
    return;
  }
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255;
  emit('scrubStart');
  emit('update:modelValue', { r: n(0), g: n(2), b: n(4) });
  emit('scrubEnd');
}
</script>

<template>
  <div class="flex flex-col gap-1.5" :class="disabled && 'opacity-50 pointer-events-none'">
    <div v-if="label" class="text-xs text-muted-foreground">{{ label }}</div>
    <component
      :is="Fader"
      v-for="ch in CHANNELS"
      :key="ch.key"
      :model-value="modelValue[ch.key]"
      :label="ch.label"
      :color="ch.color"
      :size="size"
      unit="%"
      :disabled="disabled"
      @update:model-value="(v: number) => setChannel(ch.key, v)"
      @scrub-start="emit('scrubStart')"
      @scrub-end="emit('scrubEnd')"
    />
    <div v-if="swatches?.length" class="grid grid-cols-8 gap-1.5 pt-1">
      <button
        v-for="(sw, i) in swatches"
        :key="i"
        type="button"
        class="size-6 rounded border border-border hover:scale-110 transition-transform focus:outline-none focus:ring-2 focus:ring-ring"
        :style="{ backgroundColor: swatchCss(sw) }"
        :title="sw.label"
        :aria-label="sw.label ?? 'Swatch'"
        @click="pickSwatch(sw)"
      />
    </div>
    <div class="flex items-center gap-2">
      <span class="size-6 rounded border border-border shrink-0" :style="{ backgroundColor: hex }" />
      <input
        v-model="hexText"
        class="flex-1 h-7 rounded-md border border-border bg-background px-2 text-xs font-mono outline-none focus:ring-1 focus:ring-ring"
        spellcheck="false"
        aria-label="Hex color"
        @keydown.enter="commitHex"
        @blur="commitHex"
      />
    </div>
  </div>
</template>

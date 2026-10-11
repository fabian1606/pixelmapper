<script setup lang="ts">
/**
 * Core default of `pm.gradient` (plan M7.2): a gradient bar with stops.
 * Drag a stop to move it; click the bar to add a stop (color interpolated);
 * Delete/Backspace removes the selected stop (at least one stays), as does
 * "Remove stop" in its popover; clicking a stop opens `pm.colorInput` in a
 * popover (replaceable, so the color picker extension applies). One drag or
 * edit is one undo step.
 */
import { computed, defineAsyncComponent, ref } from 'vue';
import type { GradientEmits, GradientProps, GradientStop, RgbColor } from '@pixelmapper/extension-api';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
// Lazy: `Replaceable` resolves the pm.* defaults, which include this component (import cycle).
const Replaceable = defineAsyncComponent(() => import('~/components/extension-host/Replaceable.vue'));

const props = withDefaults(defineProps<GradientProps>(), { disabled: false, size: 'md' });
const emit = defineEmits<GradientEmits>();

const MAX_STOPS = 8;
const barRef = ref<HTMLElement | null>(null);
const rootRef = ref<HTMLElement | null>(null);
const selected = ref<number | null>(null);
const editing = ref<number | null>(null);

const stops = computed(() => [...(props.modelValue?.stops ?? [])].sort((a, b) => a.pos - b.pos));
const css = (c: RgbColor) => `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
const barStyle = computed(() => ({
  background: stops.value.length > 1
    ? `linear-gradient(to right, ${stops.value.map(s => `${css(s.color)} ${s.pos * 100}%`).join(', ')})`
    : css(stops.value[0]?.color ?? { r: 0, g: 0, b: 0 }),
}));

/** Color of the gradient at `u` (linear between stops). */
function colorAt(u: number): RgbColor {
  const s = stops.value;
  if (u <= s[0]!.pos) return { ...s[0]!.color };
  for (let i = 1; i < s.length; i++) {
    if (u <= s[i]!.pos) {
      const t = (u - s[i - 1]!.pos) / Math.max(1e-6, s[i]!.pos - s[i - 1]!.pos);
      const a = s[i - 1]!.color;
      const b = s[i]!.color;
      return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
    }
  }
  return { ...s[s.length - 1]!.color };
}

/** Pointer → position 0–1 on the bar. */
function posOf(e: { clientX: number }): number {
  const r = barRef.value!.getBoundingClientRect();
  return Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))) * 1000) / 1000;
}

/** Emits a discrete change as one undo step. */
function commit(next: GradientStop[]) {
  emit('scrubStart');
  emit('update:modelValue', { stops: next });
  emit('scrubEnd');
}

/** Click on the bar adds a stop with the color at that position. */
function onBarDown(e: PointerEvent) {
  if (props.disabled || e.button !== 0 || stops.value.length >= MAX_STOPS) return;
  const pos = posOf(e);
  const next = [...stops.value, { pos, color: colorAt(pos) }].sort((a, b) => a.pos - b.pos);
  selected.value = next.findIndex(s => s.pos === pos);
  commit(next);
}

/** Drags a stop; a press without movement opens its color. */
function onStopDown(e: PointerEvent, i: number) {
  if (props.disabled || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  selected.value = i;
  // preventDefault keeps the focus away: focus the editor so Delete/Backspace reach it.
  rootRef.value?.focus({ preventScroll: true });
  const x0 = e.clientX;
  let moved = false;
  const move = (me: PointerEvent) => {
    if (!moved && Math.abs(me.clientX - x0) < 3) return;
    if (!moved) emit('scrubStart');
    moved = true;
    const next = stops.value.map((s, k) => (k === i ? { ...s, pos: posOf(me) } : s));
    emit('update:modelValue', { stops: next });
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (moved) emit('scrubEnd');
    else editing.value = i;
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/** Removes stop i (at least one stays) as one undo step. */
function removeStop(i: number) {
  if (stops.value.length <= 1) return;
  commit(stops.value.filter((_, k) => k !== i));
  selected.value = null;
  editing.value = null;
}

function onKey(e: KeyboardEvent) {
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected.value !== null) {
    e.preventDefault();
    // Global shortcuts (delete fixtures) must not see this key.
    e.stopPropagation();
    removeStop(selected.value);
  }
}

/** Sets the color of the edited stop (live; the color input brackets scrubs). */
function setColor(c: RgbColor) {
  if (editing.value === null) return;
  emit('update:modelValue', { stops: stops.value.map((s, k) => (k === editing.value ? { ...s, color: c } : s)) });
}
</script>

<template>
  <div class="flex flex-col gap-1" :class="disabled && 'opacity-50 pointer-events-none'">
    <span v-if="label" class="text-xs text-muted-foreground truncate">{{ label }}</span>
    <div ref="rootRef" class="relative pb-3 outline-none" tabindex="0" aria-label="Gradient" @keydown="onKey">
      <div ref="barRef" class="h-6 rounded border border-border/60 cursor-copy" :style="barStyle" data-gradient-bar @pointerdown="onBarDown" />
      <Popover v-for="(s, i) in stops" :key="i" :open="editing === i" @update:open="v => { if (!v) editing = null; }">
        <PopoverAnchor as-child>
          <button
            type="button"
            class="absolute top-4 -translate-x-1/2 w-3 h-3 rotate-45 border-2 shadow cursor-ew-resize"
            :class="selected === i ? 'border-primary' : 'border-background'"
            :style="{ left: `${s.pos * 100}%`, background: css(s.color) }"
            :aria-label="`Stop ${i + 1}`"
            :data-stop="i"
            @pointerdown="e => onStopDown(e, i)"
          />
        </PopoverAnchor>
        <PopoverContent class="w-56 p-2" data-overlay-root @pointerdown.stop @keydown.stop>
          <Replaceable name="pm.colorInput" :model-value="s.color" label="Stop color" @update:model-value="setColor" @scrub-start="emit('scrubStart')" @scrub-end="emit('scrubEnd')" />
          <button
            v-if="stops.length > 1" type="button" class="mt-2 text-[11px] text-muted-foreground hover:text-destructive"
            data-remove-stop @click="removeStop(i)"
          >
            Remove stop
          </button>
        </PopoverContent>
      </Popover>
    </div>
  </div>
</template>

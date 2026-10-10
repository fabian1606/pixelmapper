<script setup lang="ts">
/**
 * Core default of `pm.pickCount` (plan M9.5): "N of M on" — a row of M dots
 * (the numbered fixtures) with a draggable divider; the dots left of it are
 * lit. Count 0 means "a third" (shown as Auto). One drag is one undo step.
 */
import { computed, ref } from 'vue';
import type { PickCountEmits, PickCountProps } from '@pixelmapper/extension-api';
import { ACCENT } from './curve/curve-geometry';

const props = withDefaults(defineProps<PickCountProps>(), { disabled: false, size: 'md', rankCount: 0 });
const emit = defineEmits<PickCountEmits>();

const rowRef = ref<HTMLElement | null>(null);
const m = computed(() => Math.max(1, props.rankCount || 8));
const auto = computed(() => (props.modelValue?.count ?? 0) <= 0);
const n = computed(() => (auto.value ? Math.ceil(m.value / 3) : Math.min(m.value, props.modelValue.count)));

/** Drags the divider. */
function onDown(e: PointerEvent) {
  if (props.disabled || e.button !== 0) return;
  e.preventDefault();
  emit('scrubStart');
  const move = (me: { clientX: number }) => {
    const r = rowRef.value!.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (me.clientX - r.left) / Math.max(1, r.width)));
    emit('update:modelValue', { count: Math.max(1, Math.round(f * m.value)) });
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    emit('scrubEnd');
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  move(e);
}

function setAuto() {
  emit('scrubStart');
  emit('update:modelValue', { count: 0 });
  emit('scrubEnd');
}
</script>

<template>
  <div class="flex flex-col gap-1" :class="disabled && 'opacity-50 pointer-events-none'">
    <div class="flex items-center justify-between text-xs text-muted-foreground">
      <span>{{ label ?? 'Fixtures on' }}</span>
      <span class="flex items-center gap-2">
        <span class="font-mono text-[10px] text-foreground" data-pick-label>{{ n }} of {{ m }} on</span>
        <button type="button" class="text-[10px] rounded px-1 border" :class="auto ? 'border-primary/40 text-primary' : 'border-border/60 hover:text-foreground'" :aria-pressed="auto" @click="setAuto">Auto (⅓)</button>
      </span>
    </div>
    <div ref="rowRef" class="relative flex items-center gap-[3px] h-5 cursor-ew-resize select-none touch-none" data-pick-row @pointerdown="onDown">
      <span
        v-for="i in m" :key="i" class="flex-1 h-2.5 rounded-full border"
        :style="i <= n ? { background: ACCENT, borderColor: ACCENT } : { borderColor: 'currentColor', opacity: 0.3 }"
      />
      <span class="absolute top-0 bottom-0 w-0.5 bg-foreground" :style="{ left: `calc(${(n / m) * 100}% - 1px)` }" />
    </div>
  </div>
</template>

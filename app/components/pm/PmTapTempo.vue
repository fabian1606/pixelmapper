<script setup lang="ts">
/**
 * Core default of `pm.tapTempo` (ADR §5.4): shows the tempo with a beat
 * pulse; tapping (≥ 2 taps within 2.5 s) averages the last 8 intervals into a
 * new BPM (20–300). Emits `tap` on every tap, then `update:modelValue`.
 */
import { computed, onUnmounted, ref } from 'vue';
import type { TapTempoEmits, TapTempoProps } from '@pixelmapper/extension-api';

const props = withDefaults(defineProps<TapTempoProps>(), { disabled: false, size: 'md' });
const emit = defineEmits<TapTempoEmits>();

const tapTimes = ref<number[]>([]);
let resetTimer: ReturnType<typeof setTimeout> | null = null;
onUnmounted(() => { if (resetTimer) clearTimeout(resetTimer); });

/** Records a tap and derives the tempo from the recent intervals. */
function onTap() {
  if (props.disabled) return;
  const now = Date.now();
  if (resetTimer) clearTimeout(resetTimer);
  resetTimer = setTimeout(() => { tapTimes.value = []; }, 2500);
  tapTimes.value = [...tapTimes.value, now].slice(-8);
  emit('tap');

  if (tapTimes.value.length >= 2) {
    const t = tapTimes.value;
    const avg = (t[t.length - 1]! - t[0]!) / (t.length - 1);
    emit('update:modelValue', Math.max(20, Math.min(300, Math.round(60000 / avg))));
  }
}

const tapCount = computed(() => tapTimes.value.length);
/** Pulse during the first 12 % of each beat. */
const pulsing = computed(() => props.phase !== undefined && props.phase < 0.12);
</script>

<template>
  <button
    type="button"
    class="w-full h-full rounded flex flex-col items-center justify-center gap-1 select-none transition-all cursor-pointer active:scale-95"
    :style="{ backgroundColor: color ?? '#1e293b' }"
    :disabled="disabled"
    :aria-label="label ?? 'Tap tempo'"
    @pointerdown="onTap"
  >
    <span
      class="rounded-full transition-all duration-75 bg-white"
      :class="pulsing ? 'w-4 h-4 opacity-100' : 'w-3 h-3 opacity-40'"
    />
    <span class="text-white font-mono font-bold leading-none" style="font-size: clamp(10px, 2cqi, 22px)">
      {{ modelValue }}
    </span>
    <span class="text-white/40 font-mono leading-none" style="font-size: clamp(7px, 1.2cqi, 11px)">
      {{ tapCount >= 2 ? `tap (${tapCount})` : (label ?? 'BPM') }}
    </span>
  </button>
</template>

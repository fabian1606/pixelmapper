<script setup lang="ts">
import { computed } from 'vue';
import { Activity, ArrowRightToLine, Infinity as InfinityIcon, Timer } from 'lucide-vue-next';

/**
 * Duration input in the style of the modifier SpeedControl: a square button
 * cycles the mode, next to it sits the value. Used for an action's Duration
 * (forever / beats / time / once) and a long press's "Hold for" (beats / time).
 */
type Mode = 'forever' | 'beats' | 'time' | 'once';
type Value = { mode: Mode; beats?: number; ms?: number };

const props = defineProps<{
  modelValue: Value;
  /** Modes offered, in cycle order. */
  modes: Mode[];
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: Value): void;
}>();

const BEAT_OPTIONS = [
  { label: '1/16', value: 0.0625 },
  { label: '1/8', value: 0.125 },
  { label: '1/4', value: 0.25 },
  { label: '1/2', value: 0.5 },
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '4', value: 4 },
  { label: '8', value: 8 },
];
const TIME_OPTIONS = [
  { label: '250 ms', value: 250 },
  { label: '500 ms', value: 500 },
  { label: '1 s', value: 1000 },
  { label: '2 s', value: 2000 },
  { label: '3 s', value: 3000 },
  { label: '5 s', value: 5000 },
  { label: '10 s', value: 10000 },
];
const MODE_TITLES: Record<Mode, string> = {
  forever: 'Forever',
  beats: 'Beats',
  time: 'Time',
  once: 'Once (one pass of the preset)',
};

/** Shown mode: falls back to the first offered one. */
const mode = computed<Mode>(() => (props.modes.includes(props.modelValue.mode) ? props.modelValue.mode : props.modes[0] ?? 'forever'));

const ModeIcon = computed(() => {
  switch (mode.value) {
    case 'beats': return Activity;
    case 'time': return Timer;
    case 'once': return ArrowRightToLine;
    default: return InfinityIcon;
  }
});

function cycleMode() {
  const next = props.modes[(props.modes.indexOf(mode.value) + 1) % props.modes.length] ?? 'forever';
  if (next === 'beats') emit('update:modelValue', { mode: 'beats', beats: props.modelValue.beats ?? 1 });
  else if (next === 'time') emit('update:modelValue', { mode: 'time', ms: props.modelValue.ms ?? 1000 });
  else emit('update:modelValue', { mode: next });
}
</script>

<template>
  <div class="flex items-center gap-1">
    <button
      type="button"
      class="flex-shrink-0 h-8 w-8 rounded-md border border-input bg-muted/50 hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground transition-all shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
      :title="`Mode: ${MODE_TITLES[mode]} (click to change)`"
      @click="cycleMode"
    >
      <component :is="ModeIcon" class="w-4 h-4" />
    </button>

    <select
      v-if="mode === 'beats'"
      class="flex-1 min-w-0 h-8 text-xs font-mono bg-background border border-border rounded-md px-2"
      :value="String(modelValue.beats ?? 1)"
      @change="(e) => emit('update:modelValue', { mode: 'beats', beats: Number((e.target as HTMLSelectElement).value) })"
    >
      <option v-for="o in BEAT_OPTIONS" :key="o.value" :value="String(o.value)">{{ o.label }}</option>
    </select>

    <select
      v-else-if="mode === 'time'"
      class="flex-1 min-w-0 h-8 text-xs font-mono bg-background border border-border rounded-md px-2"
      :value="String(modelValue.ms ?? 1000)"
      @change="(e) => emit('update:modelValue', { mode: 'time', ms: Number((e.target as HTMLSelectElement).value) })"
    >
      <option v-for="o in TIME_OPTIONS" :key="o.value" :value="String(o.value)">{{ o.label }}</option>
    </select>

    <div
      v-else
      class="flex-1 h-8 flex items-center justify-center bg-muted/30 border border-input border-dashed rounded-md text-xs text-muted-foreground select-none shadow-xs"
    >
      {{ mode === 'once' ? 'One pass' : 'Forever' }}
    </div>
  </div>
</template>

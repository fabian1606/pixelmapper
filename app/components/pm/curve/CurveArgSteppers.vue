<script setup lang="ts">
/**
 * Steppers for shape args without a handle (plan §4: "Repeat ◀1▶"), e.g.
 * `repeat` or the step `count` (0 = one step per fixture).
 */
import { computed } from 'vue';
import type { CurveShapeValue, ShapeArgDef } from '@pixelmapper/extension-api';
import { clampArgs, getShape } from '~/utils/params/curve-shapes';

const props = defineProps<{
  value: CurveShapeValue;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  update: [args: Record<string, number>];
}>();

const def = computed(() => getShape(props.value.shape));
const args = computed(() => (def.value ? clampArgs(def.value, props.value.args) : {}));
const steppers = computed(() => (def.value?.args ?? []).filter(a => a.handle.kind === 'none'));

/** Display of an arg value (`count` 0 means "per fixture"). */
function display(a: ShapeArgDef): string {
  const v = args.value[a.key] ?? a.default;
  if (a.key === 'count' && v === 0) return 'Per fixture';
  return String(Math.round(v * 100) / 100);
}

/** Steps an arg by ±step within its range. */
function step(a: ShapeArgDef, dir: number) {
  const v = (args.value[a.key] ?? a.default) + dir * (a.step ?? 1);
  emit('update', { ...args.value, [a.key]: Math.max(a.min, Math.min(a.max, v)) });
}
</script>

<template>
  <div v-for="a in steppers" :key="a.key" class="flex items-center gap-1" :data-stepper="a.key">
    <span>{{ a.label }}</span>
    <button type="button" class="px-1 rounded hover:bg-muted disabled:opacity-40" :aria-label="`Decrease ${a.label}`" :disabled="disabled || (args[a.key] ?? a.default) <= a.min" @click="step(a, -1)">◀</button>
    <span class="min-w-[1.5rem] text-center font-mono text-foreground">{{ display(a) }}</span>
    <button type="button" class="px-1 rounded hover:bg-muted disabled:opacity-40" :aria-label="`Increase ${a.label}`" :disabled="disabled || (args[a.key] ?? a.default) >= a.max" @click="step(a, 1)">▶</button>
  </div>
</template>

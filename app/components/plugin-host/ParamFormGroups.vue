<script setup lang="ts">
/**
 * Param groups of `ParamForm` (plan M5.3): each param with its `pm.*` input
 * (`PARAM_DEFAULT_INPUT`, or `ui`); enums with ≤ 3 options and no `ui`
 * render as a segmented control. Params with the same `group` share a titled
 * section.
 */
import { useSlots } from 'vue';
import { PARAM_DEFAULT_INPUT, type ParamDef, type ParamSchema, type ParamValue, type PmInputName } from '@pixelmapper/extension-api';
import Replaceable from '~/components/extension-host/Replaceable.vue';
import SegmentedControl from '~/components/engine/SegmentedControl.vue';
import type { ParamGroup } from './param-form-layout';

const props = defineProps<{
  groups: ParamGroup[];
  schema: ParamSchema;
  modelValue: Record<string, ParamValue>;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  ticks?: number;
  beats?: number;
  playhead?: number | null;
  /** Live time phase (unwrapped) for step grids. */
  timePhase?: number | null;
}>();

const emit = defineEmits<{
  set: [key: string, value: ParamValue];
  scrubStart: [];
  scrubEnd: [];
}>();

const slots = useSlots();

/** The `pm.*` input of a param. */
function inputOf(p: ParamDef): PmInputName {
  return p.ui ?? PARAM_DEFAULT_INPUT[p.type];
}

/** Segmented enums: up to three options and no explicit input. */
const segmented = (p: ParamDef) => p.type === 'enum' && !p.ui && p.options.length <= 3;

/** Current value of a param (default when unset). */
function valueOf(p: ParamDef): ParamValue {
  return props.modelValue[p.key] ?? p.default;
}

/** Type-specific props for the input. */
function inputProps(p: ParamDef): Record<string, unknown> {
  const base = { label: p.label, size: props.size, disabled: props.disabled, title: p.description };
  switch (p.type) {
    case 'number':
      return { ...base, min: p.min, max: p.max, step: p.step, unit: p.unit, showValue: true };
    case 'int':
      return { ...base, min: p.min, max: p.max, step: 1 };
    case 'enum':
      return { ...base, options: p.options.map((o, i) => ({ value: o, label: p.optionLabels?.[i] ?? o })) };
    case 'point':
      return { ...base, axisLabels: ['X', 'Y'] };
    case 'curve': {
      const domain = p.domain ?? 'cycle';
      return {
        ...base,
        shapes: p.shapes,
        allowFree: p.allowFree ?? true,
        domain,
        axis: p.axis ?? 'none',
        range: p.range ?? 'unipolar',
        ticks: p.axis === 'beats' ? props.beats : props.ticks,
        playhead: domain === 'cycle' ? props.playhead : null,
        strip: !!slots[`strip:${p.key}`],
      };
    }
    case 'steps':
      return { ...base, activeGroups: props.ticks ?? 0, playhead: props.timePhase ?? null };
    default:
      return base;
  }
}

/** Emits a value (ints rounded). */
function set(p: ParamDef, value: ParamValue) {
  emit('set', p.key, p.type === 'int' ? Math.round(Number(value)) : value);
}
</script>

<template>
  <section v-for="g in groups" :key="g.name ?? '_'" class="flex flex-col gap-2">
    <div v-if="g.name" class="flex items-center gap-2">
      <span class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase shrink-0">{{ g.name }}</span>
      <div class="h-px bg-border flex-1" />
    </div>
    <template v-for="p in g.params" :key="p.key">
      <div v-if="segmented(p) && p.type === 'enum'" class="flex items-center gap-2" :data-param="p.key">
        <span class="w-14 shrink-0 truncate text-[11px] text-muted-foreground" :title="p.description">{{ p.label }}</span>
        <SegmentedControl
          class="flex-1" :aria-label="p.label" :disabled="disabled"
          :options="p.options.map((o, i) => ({ value: o, label: p.optionLabels?.[i] ?? o }))"
          :model-value="String(valueOf(p))"
          @update:model-value="v => { emit('scrubStart'); set(p, v); emit('scrubEnd'); }"
        />
      </div>
      <Replaceable
        v-else
        :name="inputOf(p)"
        :model-value="valueOf(p)"
        v-bind="inputProps(p)"
        :data-param="p.key"
        @update:model-value="(v: ParamValue) => set(p, v)"
        @scrub-start="emit('scrubStart')"
        @scrub-end="emit('scrubEnd')"
      >
        <template v-if="$slots[`strip:${p.key}`]" #strip><slot :name="`strip:${p.key}`" /></template>
      </Replaceable>
    </template>
  </section>
</template>

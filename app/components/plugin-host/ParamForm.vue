<script setup lang="ts">
/**
 * Renders a param schema (ADR §6.2) with the replaceable `pm.*` inputs.
 *
 * Used for content-plugin params (modifier cards) and fixture-kind configs.
 * Each param type has a default input (`PARAM_DEFAULT_INPUT`); `ui` overrides
 * it. Params with the same `group` share a titled section. `scrub-start` /
 * `scrub-end` pass through so the caller can coalesce one drag into one undo
 * step.
 */
import { computed } from 'vue';
import {
  PARAM_DEFAULT_INPUT,
  type ParamDef,
  type ParamSchema,
  type ParamValue,
  type PmInputName,
} from '@pixelmapper/extension-api';
import Replaceable from '~/components/extension-host/Replaceable.vue';

const props = withDefaults(defineProps<{
  schema: ParamSchema;
  /** Current values by key (missing keys show the default). */
  modelValue: Record<string, ParamValue>;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Fixtures in order (curve axis `fixtures`): the instance's resolved rank count. */
  ticks?: number;
  /** Beats per cycle (curve axis `beats`). */
  beats?: number;
  /** Live position in the cycle (0–1) for `cycle` curves' playheads; null = none. */
  playhead?: number | null;
}>(), { disabled: false, size: 'sm', ticks: 0, beats: 0, playhead: null });

const emit = defineEmits<{
  'update:modelValue': [values: Record<string, ParamValue>];
  /** One param changed (convenience for callers that patch single keys). */
  change: [key: string, value: ParamValue];
  scrubStart: [];
  scrubEnd: [];
}>();

/** Params grouped by `group` (ungrouped first), preserving manifest order. */
const groups = computed(() => {
  const out: { name: string | null; params: ParamDef[] }[] = [];
  for (const p of props.schema) {
    const name = p.group ?? null;
    let g = out.find(x => x.name === name);
    if (!g) {
      g = { name, params: [] };
      if (name === null) out.unshift(g);
      else out.push(g);
    }
    g.params.push(p);
  }
  return out;
});

/** The `pm.*` input of a param. */
function inputOf(p: ParamDef): PmInputName {
  return p.ui ?? PARAM_DEFAULT_INPUT[p.type];
}

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
      };
    }
    default:
      return base;
  }
}

/** Emits a new value for one param. */
function set(p: ParamDef, value: ParamValue) {
  const v = p.type === 'int' ? Math.round(Number(value)) : value;
  emit('update:modelValue', { ...props.modelValue, [p.key]: v });
  emit('change', p.key, v);
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <section v-for="g in groups" :key="g.name ?? '_'" class="flex flex-col gap-2">
      <div v-if="g.name" class="flex items-center gap-2">
        <span class="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase shrink-0">{{ g.name }}</span>
        <div class="h-px bg-border flex-1" />
      </div>
      <Replaceable
        v-for="p in g.params"
        :key="p.key"
        :name="inputOf(p)"
        :model-value="valueOf(p)"
        v-bind="inputProps(p)"
        @update:model-value="(v: ParamValue) => set(p, v)"
        @scrub-start="emit('scrubStart')"
        @scrub-end="emit('scrubEnd')"
      />
    </section>
  </div>
</template>

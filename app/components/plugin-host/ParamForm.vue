<script setup lang="ts">
/**
 * Renders a param schema (ADR §6.2) with the replaceable `pm.*` inputs —
 * v2 (plan M5.3): composite editors first (bound to several params, filtered
 * by `when`), then primary params not bound to an editor, then "More"
 * (collapsed by default, remembered per plugin) with advanced params and the
 * caller's `#more` slot. Hidden params never render.
 *
 * Used for content-plugin params (modifier cards) and fixture-kind configs.
 * `scrub-start` / `scrub-end` pass through so the caller can coalesce one
 * drag into one undo step.
 */
import { computed, ref, useSlots, watch } from 'vue';
import { ChevronRight } from 'lucide-vue-next';
import type { ParamSchema, ParamValue, PmInputName } from '@pixelmapper/extension-api';
import type { ManifestEditor } from '@pixelmapper/plugin-toolchain/types';
import Replaceable from '~/components/extension-host/Replaceable.vue';
import ParamFormGroups from './ParamFormGroups.vue';
import { applyEditorValue, editorValue, layoutParams } from './param-form-layout';

const props = withDefaults(defineProps<{
  schema: ParamSchema;
  /** Current values by key (missing keys show the default). */
  modelValue: Record<string, ParamValue>;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Composite editors (manifest `editors`). */
  editors?: ManifestEditor[];
  /** Key for remembering the "More" state (e.g. the plugin alias). */
  moreKey?: string;
  /** `distribution.mode` of the instance (for `when`). */
  distributionMode?: string;
  /** Fixtures in order (curve axis `fixtures`): the instance's resolved rank count. */
  ticks?: number;
  /** Beats per cycle (curve axis `beats`). */
  beats?: number;
  /** Live position in the cycle (0–1) for `cycle` curves' playheads; null = none. */
  playhead?: number | null;
  /** Extra props for composite editors (e.g. rank count, live phase). */
  editorContext?: Record<string, unknown>;
}>(), { disabled: false, size: 'sm', ticks: 0, beats: 0, playhead: null, editors: () => [] });

const emit = defineEmits<{
  'update:modelValue': [values: Record<string, ParamValue>];
  /** One param changed (convenience for callers that patch single keys). */
  change: [key: string, value: ParamValue];
  scrubStart: [];
  scrubEnd: [];
}>();

const slots = useSlots();
const layout = computed(() => layoutParams(props.schema, props.editors, { params: props.modelValue, distributionMode: props.distributionMode }));

/** "More" open state, remembered per plugin in localStorage. */
const storageKey = computed(() => (props.moreKey ? `pm:param-more:${props.moreKey}` : null));
const moreOpen = ref(readMore());
watch(storageKey, () => { moreOpen.value = readMore(); });
function readMore(): boolean {
  try {
    return !!props.moreKey && localStorage.getItem(`pm:param-more:${props.moreKey}`) === '1';
  }
  catch {
    return false;
  }
}
function toggleMore() {
  moreOpen.value = !moreOpen.value;
  try {
    if (storageKey.value) localStorage.setItem(storageKey.value, moreOpen.value ? '1' : '0');
  }
  catch { /* storage unavailable */ }
}
const hasMore = computed(() => layout.value.advanced.length > 0 || !!slots.more);

/** Emits a composite editor's value (bound keys only). */
function setEditor(editor: ManifestEditor, value: Record<string, ParamValue>) {
  const next = applyEditorValue(editor, props.modelValue, value);
  emit('update:modelValue', next);
  for (const key of Object.values(editor.bind)) emit('change', key, next[key]!);
}

/** Emits a new value for one param. */
function set(key: string, value: ParamValue) {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
  emit('change', key, value);
}

const groupProps = computed(() => ({
  schema: props.schema, modelValue: props.modelValue, disabled: props.disabled, size: props.size,
  ticks: props.ticks, beats: props.beats, playhead: props.playhead,
}));
</script>

<template>
  <div class="flex flex-col gap-3">
    <Replaceable
      v-for="e in layout.editors"
      :key="e.id"
      :name="(e.input as PmInputName)"
      :model-value="editorValue(e, schema, modelValue)"
      :label="e.label"
      :size="size"
      :disabled="disabled"
      v-bind="editorContext"
      :data-editor="e.id"
      @update:model-value="(v: Record<string, ParamValue>) => setEditor(e, v)"
      @scrub-start="emit('scrubStart')"
      @scrub-end="emit('scrubEnd')"
    />
    <ParamFormGroups
      v-if="layout.primary.length"
      v-bind="groupProps" :groups="layout.primary"
      @set="set" @scrub-start="emit('scrubStart')" @scrub-end="emit('scrubEnd')"
    >
      <template v-for="(_, name) in $slots" #[name]="slotProps" :key="name"><slot :name="name" v-bind="slotProps ?? {}" /></template>
    </ParamFormGroups>
    <div v-if="hasMore" class="flex flex-col gap-2">
      <button type="button" class="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground self-start" :aria-expanded="moreOpen" data-more @click.stop="toggleMore">
        <ChevronRight class="h-3.5 w-3.5 transition-transform" :class="moreOpen && 'rotate-90'" /> More
      </button>
      <div v-if="moreOpen" class="flex flex-col gap-3 pl-1" data-more-content>
        <ParamFormGroups
          v-if="layout.advanced.length"
          v-bind="groupProps" :groups="layout.advanced"
          @set="set" @scrub-start="emit('scrubStart')" @scrub-end="emit('scrubEnd')"
        />
        <slot name="more" />
      </div>
    </div>
  </div>
</template>

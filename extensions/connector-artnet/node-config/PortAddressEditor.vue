<script setup lang="ts">
/**
 * Net:Sub:Uni editor of one port's Port-Address (plan M7.3). Edits are
 * staged; “Write” emits the new 15-bit address once, the caller sends it
 * with ArtAddress. The fields show the node's address again as soon as the
 * node reports it (or when the edit is reset).
 */
import { computed, ref, watch } from 'vue';
import { useReplaceable } from '@pixelmapper/extension-api';
import { joinPortAddress, portAddressNote, portAddressPartsError, splitPortAddress, type PortAddressParts } from './port-rules';

const props = withDefaults(defineProps<{
  /** The node's current Port-Address. */
  modelValue: number;
  /** Inputs locked (offline). */
  disabled?: boolean;
  /** The write is running. */
  busy?: boolean;
  /** Extra check of a complete address (e.g. shared Sub-Net); returns the problem or null. */
  validate?: (portAddress: number) => string | null;
}>(), { disabled: false, busy: false, validate: undefined });

const emit = defineEmits<{ write: [portAddress: number] }>();

const NumberInput = useReplaceable('pm.numberInput');

/** Classes of the small buttons. */
const BUTTON = 'px-1.5 py-0.5 rounded border border-border hover:bg-accent transition-colors text-[11px] disabled:opacity-50';

/** The three switches with their ranges. */
const PARTS: readonly { key: keyof PortAddressParts; label: string; max: number }[] = [
  { key: 'net', label: 'Net', max: 127 },
  { key: 'subNet', label: 'Sub', max: 15 },
  { key: 'universe', label: 'Uni', max: 15 },
];

/** Staged switches; null = showing the node's address. */
const draft = ref<PortAddressParts | null>(null);
const shown = computed(() => draft.value ?? splitPortAddress(props.modelValue));
const partsError = computed(() => portAddressPartsError(shown.value));
const target = computed(() => (partsError.value ? null : joinPortAddress(shown.value)));
const dirty = computed(() => draft.value !== null && target.value !== props.modelValue);
const problem = computed(() => partsError.value ?? (dirty.value && target.value !== null ? props.validate?.(target.value) ?? null : null));
const note = computed(() => (dirty.value && target.value !== null ? portAddressNote(target.value) : null));

// The node reported the staged address: nothing left to write.
watch(() => props.modelValue, (now) => {
  if (draft.value && joinPortAddress(draft.value) === now) draft.value = null;
});

/** Stages one committed switch value. */
function stage(key: keyof PortAddressParts, value: number) {
  const next = { ...shown.value, [key]: value };
  draft.value = !portAddressPartsError(next) && joinPortAddress(next) === props.modelValue ? null : next;
}

/** Emits the staged address. */
function write() {
  if (!dirty.value || problem.value || target.value === null) return;
  emit('write', target.value);
}
</script>

<template>
  <div class="flex flex-col gap-0.5" data-port-address>
    <div class="flex items-center gap-1">
      <label v-for="p in PARTS" :key="p.key" class="flex items-center gap-0.5 text-[10px] text-muted-foreground" :data-part="p.key">
        {{ p.label }}
        <component
          :is="NumberInput"
          :model-value="shown[p.key]"
          :min="0"
          :max="p.max"
          :step="1"
          :precision="0"
          :disabled="disabled || busy"
          size="sm"
          class="w-12"
          @commit="(v: number) => stage(p.key, v)"
        />
      </label>
      <span class="ml-1 font-mono text-[10px] text-muted-foreground" :title="'15-bit Port-Address'">{{ target ?? '—' }}</span>
      <template v-if="dirty">
        <button type="button" :class="['ml-auto', BUTTON]" :disabled="disabled || busy || !!problem" data-write-address @click="write">
          {{ busy ? 'Writing…' : 'Write' }}
        </button>
        <button type="button" :class="BUTTON" :disabled="busy" @click="draft = null">Reset</button>
      </template>
    </div>
    <p v-if="problem" class="text-[10px] text-destructive">{{ problem }}</p>
    <p v-else-if="note" class="text-[10px] text-muted-foreground">{{ note }}</p>
  </div>
</template>

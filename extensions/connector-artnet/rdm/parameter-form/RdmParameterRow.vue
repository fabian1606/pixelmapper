<script setup lang="ts">
/**
 * One parameter of `RdmParameterForm`: label, the device's value and — for
 * writable parameters — a `pm.*` input (number, switch, choice) or a text
 * field (text, bit field, hex data). An edit is reported once, on commit
 * (blur/Enter, drag end, a flip or a choice), never per drag tick. Actions
 * (SET without data) need a second click.
 */
import { computed, ref, watch } from 'vue';
import { useReplaceable } from '@pixelmapper/extension-api';
import type { RdmFieldValue, RdmParameterField } from './field-types';
import type { RdmFieldState } from './use-rdm-parameter-form';
import { formatBitField, formatFieldValue, parseBitField } from './parameter-codec';
import { groupHex } from './wire-bytes';

const props = defineProps<{ field: RdmParameterField; state: RdmFieldState; disabled?: boolean }>();

/** Classes of the small text buttons (Send / Confirm / Cancel). */
const BUTTON = 'px-1.5 py-0.5 rounded border border-border hover:bg-accent transition-colors text-[11px] disabled:opacity-50';
const emit = defineEmits<{ commit: [value: RdmFieldValue]; run: [] }>();

const NumberInput = useReplaceable('pm.numberInput');
const Toggle = useReplaceable('pm.toggle');
const Select = useReplaceable('pm.select');

/** Edit in progress (typing, drag), null when none. */
const draft = ref<RdmFieldValue | null>(null);
/** True between `scrubStart` and `scrubEnd` of a discrete `pm.*` input. */
let scrubbing = false;
/** Action waiting for its confirming click. */
const confirming = ref(false);
/** Bumped on every device answer: re-creates text inputs whose DOM value may still hold rejected text. */
const answer = ref(0);
watch(() => [props.state.value, props.state.error, props.state.writing], () => answer.value++);

/** What the controls show: edit → value being written → device value → default (write-only). */
const shown = computed<RdmFieldValue | null>(() => {
  if (draft.value !== null) return draft.value;
  if (props.state.pending !== null) return props.state.pending;
  if (props.state.value !== null) return props.state.value;
  return !props.field.readable && 'defaultValue' in props.field ? props.field.defaultValue : null;
});

/** Inputs are locked while offline or while a write runs. */
const locked = computed(() => !!props.disabled || props.state.writing);

/** Text of read-only values and of fields without a value yet. */
const text = computed(() => {
  if (shown.value !== null) return formatFieldValue(props.field, shown.value);
  return props.state.loading ? '…' : '—';
});

/** Tooltip: label, PID, unit and access. */
const tooltip = computed(() => {
  const f = props.field;
  const parts = [f.label, `PID ${f.key}`];
  if (f.kind === 'number' && f.scale.specName !== 'NONE') parts.push(f.scale.specName);
  if (!f.writable) parts.push('read-only');
  else if (!f.readable) parts.push('write-only');
  return parts.join(' · ');
});

/** Options of `pm.select` (string values), plus an entry for an unknown device value. */
const selectOptions = computed(() => {
  if (props.field.kind !== 'enum') return [];
  const options = props.field.options.map(o => ({ value: String(o.value), label: o.label }));
  if (typeof shown.value === 'number' && !props.field.options.some(o => o.value === shown.value)) {
    options.push({ value: String(shown.value), label: `Unknown (${shown.value})` });
  }
  return options;
});

/** Reports a committed edit unless it equals the device's (error-free) value. */
function commit(value: RdmFieldValue) {
  draft.value = null;
  if (props.field.readable && props.state.error === null && value === props.state.value) return;
  emit('commit', value);
}

/** Discrete edit of a switch or choice: committed now, or at `scrubEnd` when bracketed. */
function discrete(value: RdmFieldValue) {
  draft.value = value;
  if (!scrubbing) commit(value);
}

/** Opens a bracketed edit. */
function scrubStart() {
  scrubbing = true;
}

/** Closes a bracketed edit and commits it. */
function scrubEnd() {
  scrubbing = false;
  if (draft.value !== null) commit(draft.value);
}

/** Value of a text input's change event. */
function inputText(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

/** Second click of an action. */
function confirmRun() {
  confirming.value = false;
  emit('run');
}
</script>

<template>
  <div class="flex flex-col gap-0.5" :data-pid="field.key">
    <div class="flex items-center gap-2 min-h-7">
      <span class="flex-1 min-w-0 truncate text-muted-foreground" :title="tooltip">{{ field.label }}</span>
      <span v-if="state.writing" class="text-[10px] text-muted-foreground/70">Writing…</span>
      <div class="w-36 shrink-0 flex items-center justify-end gap-1">
        <template v-if="field.kind === 'action'">
          <button v-if="!confirming" type="button" :class="BUTTON" :disabled="locked" @click="confirming = true">Send</button>
          <template v-else>
            <button type="button" :class="[BUTTON, 'text-destructive']" @click="confirmRun">Confirm</button>
            <button type="button" :class="BUTTON" @click="confirming = false">Cancel</button>
          </template>
        </template>
        <span v-else-if="!field.writable || shown === null" class="truncate font-mono tabular-nums" :title="text">{{ text }}</span>
        <component
          :is="NumberInput"
          v-else-if="field.kind === 'number'"
          :model-value="Number(shown)"
          :min="field.min"
          :max="field.max"
          :step="field.step"
          :precision="field.scale.decimals"
          :unit="field.scale.symbol || undefined"
          :disabled="locked"
          size="sm"
          class="w-full"
          @update:model-value="(v: number) => (draft = v)"
          @commit="commit"
        />
        <component
          :is="Toggle"
          v-else-if="field.kind === 'boolean'"
          :model-value="Boolean(shown)"
          :disabled="locked"
          size="sm"
          @scrub-start="scrubStart"
          @update:model-value="discrete"
          @scrub-end="scrubEnd"
        />
        <component
          :is="Select"
          v-else-if="field.kind === 'enum'"
          :model-value="String(shown)"
          :options="selectOptions"
          :disabled="locked"
          size="sm"
          class="w-full"
          @scrub-start="scrubStart"
          @update:model-value="(v: string) => discrete(Number(v))"
          @scrub-end="scrubEnd"
        />
        <input
          v-else
          :key="answer"
          type="text"
          class="w-full rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          :class="field.kind !== 'string' && 'font-mono'"
          :value="field.kind === 'bitField' ? formatBitField(Number(shown), field.layout.bytes) : field.kind === 'raw' ? groupHex(String(shown)) : String(shown)"
          :maxlength="field.kind === 'string' ? field.maxLength : undefined"
          :placeholder="field.kind === 'raw' ? 'hex bytes' : undefined"
          :disabled="locked"
          :aria-label="field.label"
          @change="(e: Event) => commit(field.kind === 'bitField' ? (parseBitField(inputText(e)) ?? Number.NaN) : inputText(e))"
        >
      </div>
    </div>
    <p v-if="state.error" class="text-[10px] text-destructive">{{ state.error }}</p>
    <p v-else-if="field.note" class="text-[10px] text-muted-foreground/70">{{ field.note }}</p>
  </div>
</template>


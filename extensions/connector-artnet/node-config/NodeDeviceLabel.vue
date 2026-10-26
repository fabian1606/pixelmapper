<script setup lang="ts">
/**
 * RDM DEVICE_LABEL of a node's responder (plan M7.3, “if applicable”):
 * shown for nodes whose label is its own setting. The Pixelmapper Node maps
 * DEVICE_LABEL to its Short Name (contract §6.3), so the Device section
 * does not mount this for it. Read on mount, written on commit, read back;
 * re-read every 45 s while shown and whenever `rereadOn` changes (queued
 * messages can be consumed by another controller, contract rev 2).
 */
import { onScopeDispose, ref, watch } from 'vue';
import type { ArtNetBackend } from '../bridge/backend';
import type { RdmAddress, RdmResult } from '../bridge/protocol-messages';
import { RDM_PID } from '../bridge/rdm-constants';
import { RDM_SETTINGS_REREAD_MS } from '../rdm/parameter-form/use-rdm-parameter-form';
import { DEVICE_LABEL_MAX_BYTES, describeNodeError, nameError } from './device-rules';

const props = withDefaults(defineProps<{
  address: RdmAddress;
  backend: ArtNetBackend;
  disabled?: boolean;
  /** Periodic re-read in ms (default 45 s; 0 = off). */
  rereadMs?: number;
  /** Any value; every change re-reads the label (the node-change counter). */
  rereadOn?: number;
}>(), { disabled: false, rereadMs: RDM_SETTINGS_REREAD_MS, rereadOn: undefined });

/** Label the node last reported; null = unknown. */
const value = ref<string | null>(null);
/** Text being edited; null = showing `value`. */
const draft = ref<string | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);

/** Text of a DEVICE_LABEL answer (`value`, else ASCII from the hex data). */
function decode(answer: Pick<RdmResult, 'data' | 'value'>): string {
  if (typeof answer.value === 'string') return answer.value;
  const bytes = answer.data.match(/../g) ?? [];
  return bytes.map(b => String.fromCharCode(Number.parseInt(b, 16))).join('').replace(/\0+$/, '');
}

/** Reads the label from the node. */
async function read() {
  try {
    value.value = decode(await props.backend.request('rdmGet', { ...props.address, pid: RDM_PID.DEVICE_LABEL }));
  }
  catch (err) {
    error.value = describeNodeError(err);
  }
}

/** Writes the edited label, then reads it back (the node's answer is shown). */
async function commit() {
  const text = draft.value;
  if (text === null) return;
  error.value = nameError(text, DEVICE_LABEL_MAX_BYTES, true);
  if (error.value) return;
  if (text === value.value) {
    draft.value = null;
    return;
  }
  busy.value = true;
  try {
    await props.backend.request('rdmSet', { ...props.address, pid: RDM_PID.DEVICE_LABEL, value: text });
    draft.value = null;
  }
  catch (err) {
    error.value = describeNodeError(err);
  }
  finally {
    await read();
    busy.value = false;
  }
}

watch(() => `${props.address.nodeId}|${props.address.uid}`, () => { void read(); }, { immediate: true });

/** Re-reads unless the label is being written or edited (the write reads it back). */
function reread() {
  if (!busy.value && draft.value === null && props.backend.state.value.kind === 'connected') void read();
}

// The node changed, and periodically (see file comment).
watch(() => props.rereadOn, reread);
if (props.rereadMs > 0) {
  const timer = setInterval(reread, props.rereadMs);
  onScopeDispose(() => clearInterval(timer));
}

// A label change at the device arrives as a queued message (contract §6.3).
const off = props.backend.on('rdmQueued', (event) => {
  if (event.uid === props.address.uid && event.pid === RDM_PID.DEVICE_LABEL) value.value = decode(event);
});
onScopeDispose(off);
</script>

<template>
  <div class="flex flex-col gap-0.5" data-field="deviceLabel">
    <div class="flex min-h-7 items-center gap-2">
      <span class="w-20 shrink-0 text-muted-foreground" title="RDM DEVICE_LABEL">Device label</span>
      <input
        type="text"
        class="w-full rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        :value="draft ?? value ?? ''"
        :maxlength="DEVICE_LABEL_MAX_BYTES"
        :placeholder="value === null ? '…' : 'no label'"
        :disabled="disabled || busy"
        aria-label="Device label"
        @input="draft = ($event.target as HTMLInputElement).value"
        @change="commit"
      >
    </div>
    <p v-if="error" class="text-[10px] text-destructive">{{ error }}</p>
  </div>
</template>

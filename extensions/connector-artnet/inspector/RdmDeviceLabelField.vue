<script setup lang="ts">
/**
 * DEVICE_LABEL of the inspected device (plan M7.2, D18): shows the label
 * the device store knows (from `rdmDescribe`, no extra GET), writes an
 * edited label on commit (Enter / blur) and shows what the device reads
 * back (D5) — also in the node's device list, which reads the same store.
 */
import { computed, ref, watch } from 'vue';
import type { RdmUid } from '../bridge/protocol-model';
import type { DeviceStore } from '../devices/device-store';
import { DEVICE_LABEL_MAX_BYTES, nameError } from '../node-config/device-rules';

const props = defineProps<{
  store: DeviceStore;
  uid: RdmUid;
  /** Label as last read from the device; null = unknown. */
  label: string | null;
  disabled?: boolean;
}>();

/** Text being edited; null = showing `label`. */
const draft = ref<string | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);
const shown = computed(() => draft.value ?? props.label ?? '');

// Another device: drop the edit.
watch(() => props.uid, () => {
  draft.value = null;
  error.value = null;
});

/** Writes the edited label, then shows the device's answer. */
async function commit() {
  const text = draft.value;
  if (text === null) return;
  error.value = nameError(text, DEVICE_LABEL_MAX_BYTES, true);
  if (error.value) return;
  if (text === props.label) {
    draft.value = null;
    return;
  }
  busy.value = true;
  try {
    await props.store.setDeviceLabel(props.uid, text);
    draft.value = null;
  }
  catch (err) {
    error.value = (err as Error).message ?? String(err);
  }
  finally {
    busy.value = false;
  }
}

/** Escape drops the edit. */
function reset() {
  draft.value = null;
  error.value = null;
}
</script>

<template>
  <div class="flex flex-col gap-0.5" data-rdm-label>
    <div class="flex min-h-7 items-center gap-2">
      <span class="w-16 shrink-0 text-muted-foreground" title="RDM DEVICE_LABEL">Label</span>
      <input
        type="text"
        class="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        :value="shown"
        :maxlength="DEVICE_LABEL_MAX_BYTES"
        :placeholder="label === null ? '…' : 'no label'"
        :disabled="disabled || busy"
        aria-label="Device label"
        @input="draft = ($event.target as HTMLInputElement).value"
        @change="commit"
        @keydown.esc="reset"
      >
    </div>
    <p v-if="error" class="text-[10px] text-destructive">{{ error }}</p>
  </div>
</template>

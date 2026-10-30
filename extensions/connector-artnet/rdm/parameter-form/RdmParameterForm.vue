<script setup lang="ts">
/**
 * Generic RDM parameter form (plan M7.1): every parameter a device lists in
 * SUPPORTED_PARAMETERS — manufacturer PIDs described by PARAMETER_DESCRIPTION
 * and the simple standard PIDs — rendered with the `pm.*` inputs.
 *
 * Values are read from the device (a few GETs at a time), written on commit
 * and read back: the form shows the device's answer, not the requested
 * value (last-writer-wins, D5); values are re-read every 45 s while shown
 * and whenever `rereadOn` changes (queued messages can be consumed by
 * another controller). Compact enough for the node's connector card
 * (Advanced, D8) and the fixture inspector's RDM section (D18).
 *
 * Usage: `<RdmParameterForm :address="{ nodeId, port, uid }" :description="describeResult" />`
 */
import type { ArtNetBackend } from '../../bridge/backend';
import type { RdmAddress } from '../../bridge/protocol-messages';
import type { RdmDeviceDescription } from '../../bridge/protocol-model';
import { getArtNetBackend } from '../../bridge/shared';
import type { RdmFieldValue } from './field-types';
import { RDM_SETTINGS_REREAD_MS, useRdmParameterForm } from './use-rdm-parameter-form';
import RdmParameterRow from './RdmParameterRow.vue';

const props = withDefaults(defineProps<{
  /** Device to talk to (node, port, UID, optional sub-device). */
  address: RdmAddress;
  /** `rdmDescribe` result of that device. */
  description: RdmDeviceDescription;
  /** Backend to use; default the app-wide bridge connection. */
  backend?: ArtNetBackend;
  /** PIDs to leave out (e.g. ones the caller shows itself). */
  exclude?: number[];
  /** Show only these PIDs. */
  only?: number[];
  /** Heading. */
  title?: string;
  /** GETs in flight at once. */
  concurrency?: number;
  /** Periodic re-read of all values in ms (default 45 s; 0 = off). */
  rereadMs?: number;
  /** Any value; every change re-reads all values (e.g. the node-change counter of the node configuration). */
  rereadOn?: number;
}>(), { backend: undefined, exclude: undefined, only: undefined, title: 'Parameters', concurrency: 2, rereadMs: RDM_SETTINGS_REREAD_MS, rereadOn: undefined });

const emit = defineEmits<{
  /** A write was accepted; `value` is what the device reports afterwards. */
  written: [change: { pid: number; value: RdmFieldValue | null }];
}>();

const form = useRdmParameterForm({
  backend: props.backend ?? getArtNetBackend(),
  address: () => props.address,
  description: () => props.description,
  build: () => ({ exclude: props.exclude, only: props.only }),
  concurrency: props.concurrency,
  onWritten: (field, value) => emit('written', { pid: field.pid, value }),
  rereadMs: props.rereadMs,
  rereadOn: () => props.rereadOn,
});
const { fields, states, connected, loading } = form;

/** Classes of the Refresh button. */
const BUTTON = 'px-1.5 py-0.5 rounded border border-border hover:bg-accent transition-colors text-[11px] disabled:opacity-50';

defineExpose({ refresh: form.refresh });
</script>

<template>
  <div class="flex flex-col gap-1 text-xs">
    <div class="flex items-center gap-2">
      <span class="font-medium text-muted-foreground">{{ title }}</span>
      <span v-if="loading" class="text-[10px] text-muted-foreground/70">Reading…</span>
      <button type="button" :class="['ml-auto', BUTTON]" :disabled="!connected || loading" title="Read all values from the device again" @click="form.refresh()">
        Refresh
      </button>
    </div>
    <p v-if="!connected" class="text-[11px] text-muted-foreground">The Art-Net bridge is not connected; values cannot be read or written.</p>
    <p v-if="!fields.length" class="text-[11px] text-muted-foreground">This device has no further parameters.</p>
    <template v-for="f in fields" :key="f.key">
      <RdmParameterRow
        v-if="states[f.key]"
        :field="f"
        :state="states[f.key]!"
        :disabled="!connected"
        @commit="(v: RdmFieldValue) => form.write(f, v)"
        @run="form.run(f)"
      />
    </template>
  </div>
</template>

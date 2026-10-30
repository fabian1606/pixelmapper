<script setup lang="ts">
/**
 * Advanced settings of one output port, collapsed inside its card block
 * (WP13; moved from the former node-config port row, plan D8/M7.3): merge
 * HTP/LTP, output style, and on the Pixelmapper Node the port's own PIDs —
 * DMX break, mark-after-break, refresh rate, background discovery and the XB proxy for stock tubes —
 * through the generic RDM parameter form. Writes go through ArtAddress and
 * RDM; the values shown are the node's answers (D5).
 */
import { computed } from 'vue';
import { useReplaceable } from '@pixelmapper/extension-api';
import type { ArtNetBackend } from '../bridge/backend';
import type { ArtAddressPortChange, RdmAddress } from '../bridge/protocol-messages';
import type { NodeState, PortState, RdmDeviceDescription } from '../bridge/protocol-model';
import RdmParameterForm from '../rdm/parameter-form/RdmParameterForm.vue';
import { MERGE_OPTIONS, OUTPUT_STYLE_OPTIONS, nodePortNumber, nodePortPids } from '../node-config/port-rules';
import { useCommandRunner } from '../node-config/use-node-context';
import InfoTip from './InfoTip.vue';

const props = defineProps<{
  node: NodeState;
  port: PortState;
  /** `Port 2`. */
  label: string;
  backend: ArtNetBackend;
  /** Bridge connected and node present. */
  online: boolean;
  /** The node's RDM responder, when it is a Pixelmapper Node (per-port PIDs). */
  rdm: { address: RdmAddress; description: RdmDeviceDescription } | null;
  /** Node-change counter: every change re-reads the per-port PIDs shown. */
  rereadOn?: number;
}>();

const Select = useReplaceable('pm.select');
const runner = useCommandRunner();
const { busy, error } = runner;

const locked = computed(() => !props.online || busy.value !== null);
/** The port's timing PIDs on the Pixelmapper Node, else null. */
const timingPids = computed(() => {
  const n = nodePortNumber(props.port.port);
  return n === null ? null : nodePortPids(n).settings;
});

/** Sends one ArtAddress change of this port. */
function writePort(key: string, change: Omit<ArtAddressPortChange, 'port'>) {
  return runner.run(key, () => props.backend.request('artAddress', { nodeId: props.node.nodeId, ports: [{ port: { ...props.port.port }, ...change }] }));
}

/** Class of the labels column. */
const LABEL = 'flex w-24 shrink-0 items-center gap-1 text-muted-foreground';
</script>

<template>
  <div class="flex flex-col gap-1 text-xs" data-port-advanced>
    <div class="flex min-h-7 items-center gap-2">
      <span :class="LABEL">Merge <InfoTip topic="merge" /></span>
      <span v-if="port.output.merging" class="rounded bg-primary/15 px-1 text-[10px] text-primary">Merging</span>
      <component :is="Select" :model-value="port.output.merge" :options="MERGE_OPTIONS" variant="segmented" size="sm" :disabled="locked" class="ml-auto w-28" data-merge @update:model-value="(v: string) => writePort('merge', { merge: v as 'htp' | 'ltp' })" />
    </div>
    <div class="flex min-h-7 items-center gap-2">
      <span :class="LABEL">Output style <InfoTip topic="outputStyle" /></span>
      <component :is="Select" v-if="node.status.outputStyleSwitchable" :model-value="port.output.style" :options="OUTPUT_STYLE_OPTIONS" variant="segmented" size="sm" :disabled="locked" class="ml-auto w-36" data-style @update:model-value="(v: string) => writePort('style', { outputStyle: v as 'delta' | 'continuous' })" />
      <span v-else class="ml-auto text-muted-foreground">{{ port.output.style === 'continuous' ? 'Continuous' : 'Delta' }}</span>
    </div>
    <p v-if="error" class="text-[10px] text-destructive">{{ error }}</p>
    <template v-if="rdm && timingPids">
      <div class="flex items-center gap-1 pt-1 text-[11px] text-muted-foreground" data-timing-heading>
        DMX timing <InfoTip topic="dmxTiming" /> &amp; background discovery <InfoTip topic="backgroundDiscovery" />
      </div>
      <RdmParameterForm :address="rdm.address" :description="rdm.description" :backend="backend" :only="timingPids" :title="`${label} timing`" :reread-on="rereadOn" />
    </template>
  </div>
</template>

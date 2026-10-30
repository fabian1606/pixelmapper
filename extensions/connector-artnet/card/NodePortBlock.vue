<script setup lang="ts">
/**
 * One port of the Art-Net card (WP13): a flat, collapsible list item. The
 * header line shows the data flow, the port, its direction, the
 * Pixelmapper universe → node Port-Address, the number of RDM devices and
 * a badge for conflicts/mismatches. Expanded, it shows the essentials
 * (direction, universe, Port-Address, RDM), the port's failsafe when the
 * card's failsafe is “Custom per port”, the RDM devices on the port (hidden
 * while RDM is off on it) and, collapsed, the port's advanced settings.
 */
import { computed } from 'vue';
import type { ArtNetBackend } from '../bridge/backend';
import type { RdmAddress } from '../bridge/protocol-messages';
import type { NodeState, RdmDeviceDescription, RdmUid } from '../bridge/protocol-model';
import { formatPortAddress } from '../bridge/protocol-model';
import type { DeviceActions } from '../devices/use-device-actions';
import type { DeviceRow } from '../devices/use-device-list';
import { PORT_MODE_LABELS, currentPortMode, type PortEnableState } from '../node-config/port-rules';
import CardSection from './CardSection.vue';
import PortAdvanced from './PortAdvanced.vue';
import PortDevices from './PortDevices.vue';
import PortEssentials from './PortEssentials.vue';
import PortFailsafe from './PortFailsafe.vue';
import type { PortEntry } from './use-port-entries';

const props = defineProps<{
  entry: PortEntry;
  /** Live node; null while it does not answer. */
  node: NodeState | null;
  backend: ArtNetBackend;
  enable: PortEnableState;
  setEnabled: (enabled: boolean) => Promise<void>;
  /** Bridge connected and node present. */
  online: boolean;
  /** The node's RDM responder, when it is a Pixelmapper Node (per-port PIDs). */
  rdm: { address: RdmAddress; description: RdmDeviceDescription } | null;
  /** Node-change counter: re-reads the per-port PIDs. */
  rereadOn?: number;
  /** RDM devices of this port. */
  devices: DeviceRow[];
  /** The port answered TodNak. */
  noRdm: boolean;
  /** Device actions; null when the node has no RDM or discovery is not active. */
  actions: DeviceActions | null;
  /** The card's failsafe is “Custom per port”. */
  failsafeCustom: boolean;
  /** Open until the user toggles it. */
  defaultOpen: boolean;
}>();
const emit = defineEmits<{ universe: [universe: number]; open: [uid: RdmUid] }>();

const state = computed(() => props.entry.state);
const mode = computed(() => (state.value ? currentPortMode(state.value, props.enable) : null));
const outputs = computed(() => mode.value === 'output' || mode.value === 'both');
/** Header text of the direction (`Output`, or `Output` while offline for a stored output). */
const direction = computed(() => (mode.value ? PORT_MODE_LABELS[mode.value] : props.entry.outputIndex >= 0 ? 'Output' : null));
/** `U1 → 0:0:1`, `U1` offline, `0:0:4` for an input. */
const mapping = computed(() => {
  const e = props.entry;
  const address = e.portAddress !== null ? formatPortAddress(e.portAddress) : null;
  if (e.outputIndex < 0) return address ?? '';
  const universe = e.universe ? `U${e.universe}` : 'off';
  return address ? `${universe} → ${address}` : universe;
});
/** Data flow dot. */
const flow = computed(() => {
  const s = state.value;
  if (s && outputs.value && s.output.data) return { on: true, title: 'Sending DMX' };
  if (s && (mode.value === 'input' || mode.value === 'both') && s.input.data) return { on: true, title: 'Receiving DMX' };
  return { on: false, title: 'No data' };
});
/** Devices shown: only while RDM is on for an output port (or offline, from the store). */
const showDevices = computed(() => !!props.actions && (state.value ? outputs.value && state.value.output.rdm : props.entry.outputIndex >= 0));
/** Devices that need attention (conflict or mismatch). */
const problems = computed(() => props.devices.filter(d => d.state === 'conflict' || d.state === 'mismatch'));
const problemText = computed(() => {
  const conflicts = problems.value.filter(d => d.state === 'conflict').length;
  const mismatches = problems.value.length - conflicts;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : word.endsWith('h') ? 'es' : 's'}`;
  return [conflicts ? plural(conflicts, 'conflict') : '', mismatches ? plural(mismatches, 'mismatch') : ''].filter(Boolean).join(' · ');
});
</script>

<template>
  <CardSection :section-id="`port:${entry.key}`" :title="entry.label" variant="block" :default-open="defaultOpen" :data-port="entry.key">
    <template #summary>
      <span class="flex min-w-0 flex-1 items-center gap-1.5 pl-1 text-[11px] text-muted-foreground" data-port-summary>
        <span class="inline-block size-1.5 shrink-0 rounded-full" :class="flow.on ? 'bg-primary' : 'bg-muted-foreground/30'" :title="flow.title" />
        <span v-if="direction">{{ direction }}</span>
        <span class="truncate font-mono" :title="entry.differs ? 'Universe and the node\'s Port-Address differ; DMX still arrives' : 'Pixelmapper universe → node Port-Address'">{{ mapping }}</span>
        <span class="ml-auto flex shrink-0 items-center gap-1">
          <span v-if="showDevices" class="rounded bg-muted px-1 text-[10px]" :title="`${devices.length} RDM devices on this port`" data-port-count>
            {{ devices.length }} {{ devices.length === 1 ? 'device' : 'devices' }}
          </span>
          <span v-if="showDevices && problems.length" class="rounded bg-destructive/15 px-1 text-[10px] text-destructive" data-port-problems>{{ problemText }}</span>
        </span>
      </span>
    </template>
    <div class="flex flex-col gap-1">
      <PortEssentials :entry="entry" :node="node" :backend="backend" :enable="enable" :set-enabled="setEnabled" :online="online" @universe="emit('universe', $event)" />
      <PortFailsafe v-if="failsafeCustom && node && state?.canOutput" :node="node" :port="state" :label="entry.label" :backend="backend" :online="online" />
      <PortDevices
        v-if="showDevices && actions"
        :rows="devices"
        :port="entry.port"
        :port-key="entry.key"
        :no-rdm="noRdm"
        :online="online"
        :actions="actions"
        @open="emit('open', $event)"
      />
      <CardSection v-if="node && state && outputs" :section-id="`port:${entry.key}:advanced`" title="Advanced" info="portAdvanced" variant="sub">
        <PortAdvanced :node="node" :port="state" :label="entry.label" :backend="backend" :online="online" :rdm="mode === 'output' ? rdm : null" :reread-on="rereadOn" />
      </CardSection>
    </div>
  </CardSection>
</template>

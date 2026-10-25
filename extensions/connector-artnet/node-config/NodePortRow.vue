<script setup lang="ts">
/**
 * Settings of one node port (plan D8, M7.3): mode (output / input / off),
 * Port-Address, and for outputs merge, RDM and output style; the node's
 * per-port PIDs (DMX timing, background discovery) behind “DMX timing”.
 *
 * Every control shows the node's state (D5): a write locks the row until
 * the bridge answers, and the new value appears with the node's `node`
 * event. Leaving a mode while data flows asks first.
 */
import { computed, ref } from 'vue';
import { useReplaceable } from '@pixelmapper/extension-api';
import type { ArtNetBackend } from '../bridge/backend';
import type { ArtAddressPortChange, RdmAddress } from '../bridge/protocol-messages';
import type { NodeState, PortState, RdmDeviceDescription } from '../bridge/protocol-model';
import RdmParameterForm from '../rdm/parameter-form/RdmParameterForm.vue';
import { useCommandRunner } from './use-node-context';
import {
  MERGE_OPTIONS,
  OUTPUT_STYLE_OPTIONS,
  PORT_MODE_LABELS,
  currentPortMode,
  editedAddressField,
  modeChangeConfirmation,
  nodePortNumber,
  nodePortPids,
  planModeChange,
  portModeOptions,
  sharedSubNetError,
  type PortEnableState,
  type PortMode,
} from './port-rules';
import ConfirmBox from './ConfirmBox.vue';
import PortAddressEditor from './PortAddressEditor.vue';

const props = defineProps<{
  node: NodeState;
  port: PortState;
  /** `Port 2`. */
  label: string;
  backend: ArtNetBackend;
  /** RDM `PORTn_ENABLED` of this port. */
  enable: PortEnableState;
  /** Writes `PORTn_ENABLED` (and reads it back). */
  setEnabled: (enabled: boolean) => Promise<void>;
  /** Bridge connected and node present. */
  online: boolean;
  /** The node's RDM responder, when it is a Pixelmapper Node (per-port PIDs). */
  rdm: { address: RdmAddress; description: RdmDeviceDescription } | null;
}>();

const Select = useReplaceable('pm.select');
const Toggle = useReplaceable('pm.toggle');
const runner = useCommandRunner();
const { busy, error } = runner;

/** Mode the user picked that waits for confirmation. */
const pendingMode = ref<PortMode | null>(null);
/** “DMX timing” open. */
const showTiming = ref(false);

const current = computed(() => currentPortMode(props.port, props.enable));
const modes = computed(() => portModeOptions(props.node, props.port, props.enable).map(m => ({ value: m, label: PORT_MODE_LABELS[m] })));
const outputs = computed(() => current.value === 'output' || current.value === 'both');
const inputs = computed(() => current.value === 'input' || current.value === 'both');
const addressField = computed(() => editedAddressField(props.port));
const locked = computed(() => !props.online || busy.value !== null);
const confirmMessage = computed(() => (pendingMode.value ? modeChangeConfirmation(props.label, props.port, current.value, pendingMode.value, props.node.refreshRate) : null));
const timingPids = computed(() => {
  const n = nodePortNumber(props.port.port);
  return n === null ? null : nodePortPids(n).settings;
});

/** Dot and tooltip of the data flow. */
const flow = computed(() => {
  if (outputs.value && props.port.output.data) return { on: true, title: 'Sending DMX' };
  if (inputs.value && props.port.input.data) return { on: true, title: 'Receiving DMX' };
  return { on: false, title: 'No data' };
});

/** Sends one ArtAddress change of this port. */
function writePort(key: string, change: Omit<ArtAddressPortChange, 'port'>) {
  return runner.run(key, () => props.backend.request('artAddress', { nodeId: props.node.nodeId, ports: [{ port: { ...props.port.port }, ...change }] }));
}

/** User picked a mode: ask first when data would stop. */
function chooseMode(value: string) {
  const target = value as PortMode;
  if (target === current.value) return;
  if (modeChangeConfirmation(props.label, props.port, current.value, target, props.node.refreshRate)) pendingMode.value = target;
  else void applyMode(target);
}

/** Runs the requests of a mode change in order. */
async function applyMode(target: PortMode) {
  const steps = planModeChange(props.port, props.enable, target);
  await runner.run('mode', async () => {
    for (const step of steps) {
      if (step.kind === 'direction') {
        await props.backend.request('artAddress', { nodeId: props.node.nodeId, ports: [{ port: { ...props.port.port }, direction: step.direction }] });
      }
      else if (step.kind === 'rdmEnabled') await props.setEnabled(step.enabled);
      else {
        // ArtInput carries one flag per port of the BindIndex: the others keep theirs.
        const disabled = props.node.ports.filter(p => p.port.bind === props.port.port.bind).sort((a, b) => a.port.index - b.port.index)
          .map(p => (p.port.index === props.port.port.index ? step.disabled : p.input.disabled));
        await props.backend.request('artInput', { nodeId: props.node.nodeId, bind: props.port.port.bind, disabled });
      }
    }
  });
  pendingMode.value = null;
}

/** Writes the staged Port-Address (input address of input ports, else output address). */
function writeAddress(portAddress: number) {
  const change: Omit<ArtAddressPortChange, 'port'> = addressField.value === 'inputPortAddress' ? { inputPortAddress: portAddress } : { outputPortAddress: portAddress };
  return writePort('address', change);
}

/** Checks a staged Port-Address against the shared Net/Sub-Net of the BindIndex. */
function validateAddress(portAddress: number): string | null {
  return sharedSubNetError(props.node, props.port.port, addressField.value, portAddress);
}
</script>

<template>
  <div class="flex flex-col gap-1 rounded border border-border/60 p-1.5 text-xs" :data-port="`${port.port.bind}.${port.port.index}`">
    <div class="flex min-h-7 items-center gap-2">
      <span class="inline-block size-1.5 shrink-0 rounded-full" :class="flow.on ? 'bg-primary' : 'bg-muted-foreground/30'" :title="flow.title" />
      <span class="font-medium">{{ label }}</span>
      <span v-if="busy" class="text-[10px] text-muted-foreground/70">Writing…</span>
      <div class="ml-auto flex w-44 justify-end" data-mode>
        <component :is="Select" v-if="modes.length > 1" :model-value="current" :options="modes" variant="segmented" size="sm" :disabled="locked || !!pendingMode" class="w-full" @update:model-value="chooseMode" />
        <span v-else class="text-muted-foreground">{{ PORT_MODE_LABELS[current] }}</span>
      </div>
    </div>
    <ConfirmBox
      v-if="pendingMode && confirmMessage"
      :message="confirmMessage"
      :confirm-label="`Switch to ${PORT_MODE_LABELS[pendingMode].toLowerCase()}`"
      :busy="busy === 'mode'"
      @confirm="applyMode(pendingMode)"
      @cancel="pendingMode = null"
    />
    <div class="flex items-center gap-2">
      <span class="w-20 shrink-0 text-muted-foreground">Port-Address</span>
      <PortAddressEditor
        class="flex-1"
        :model-value="port[addressField]"
        :disabled="!online || (busy !== null && busy !== 'address')"
        :busy="busy === 'address'"
        :validate="validateAddress"
        @write="writeAddress"
      />
    </div>
    <template v-if="outputs">
      <div class="flex min-h-7 items-center gap-2">
        <span class="w-20 shrink-0 text-muted-foreground">Merge</span>
        <span v-if="port.output.merging" class="rounded bg-primary/15 px-1 text-[10px] text-primary">Merging</span>
        <component :is="Select" :model-value="port.output.merge" :options="MERGE_OPTIONS" variant="segmented" size="sm" :disabled="locked" class="ml-auto w-28" data-merge @update:model-value="(v: string) => writePort('merge', { merge: v as 'htp' | 'ltp' })" />
      </div>
      <div class="flex min-h-7 items-center gap-2">
        <span class="w-20 shrink-0 text-muted-foreground">RDM</span>
        <div class="ml-auto flex" data-rdm>
          <component :is="Toggle" v-if="node.status.rdmSwitchable" :model-value="port.output.rdm" :disabled="locked" size="sm" @update:model-value="(v: boolean) => writePort('rdm', { rdm: v })" />
          <span v-else class="text-muted-foreground">{{ port.output.rdm ? 'On' : 'Off' }}</span>
        </div>
      </div>
      <div class="flex min-h-7 items-center gap-2">
        <span class="w-20 shrink-0 text-muted-foreground">Output style</span>
        <component :is="Select" v-if="node.status.outputStyleSwitchable" :model-value="port.output.style" :options="OUTPUT_STYLE_OPTIONS" variant="segmented" size="sm" :disabled="locked" class="ml-auto w-36" data-style @update:model-value="(v: string) => writePort('style', { outputStyle: v as 'delta' | 'continuous' })" />
        <span v-else class="ml-auto text-muted-foreground">{{ port.output.style === 'continuous' ? 'Continuous' : 'Delta' }}</span>
      </div>
      <p v-if="port.output.shortCircuit" class="text-[10px] text-destructive">The node detected a short circuit on the DMX line.</p>
    </template>
    <p v-if="inputs" class="text-[10px] text-muted-foreground">
      {{ port.input.data ? 'Receiving DMX' : 'No input signal' }}<template v-if="port.input.errors"> · receive errors</template>
    </p>
    <p v-if="error" class="text-[10px] text-destructive">{{ error }}</p>
    <template v-if="rdm && timingPids && current === 'output'">
      <button type="button" class="self-start text-[10px] text-muted-foreground hover:text-foreground" :aria-expanded="showTiming" @click="showTiming = !showTiming">
        {{ showTiming ? '▾' : '▸' }} DMX timing &amp; discovery
      </button>
      <RdmParameterForm v-if="showTiming" :address="rdm.address" :description="rdm.description" :backend="backend" :only="timingPids" :title="`${label} timing`" />
    </template>
  </div>
</template>

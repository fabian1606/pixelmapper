<script setup lang="ts">
/**
 * Essentials of one port in its card block (WP13; logic moved from the
 * former node-config port row, plan D8/M7.3, and port table, D7/M5.5):
 * direction (output / input / off), the Pixelmapper universe the port
 * outputs, the node's Port-Address (Net:Sub:Uni editor — the only place
 * that writes it) and RDM on/off.
 *
 * Node settings show the node's state (D5): a write locks the controls
 * until the bridge answers, and the new value appears with the node's
 * `node` event. Leaving a mode while data flows asks first. The universe
 * is connector config and is emitted as a patch.
 */
import { computed, ref } from 'vue';
import { useReplaceable } from '@pixelmapper/extension-api';
import type { ArtNetBackend } from '../bridge/backend';
import type { ArtAddressPortChange } from '../bridge/protocol-messages';
import type { NodeState, PortState } from '../bridge/protocol-model';
import { formatPortAddress } from '../bridge/protocol-model';
import {
  PORT_MODE_LABELS,
  currentPortMode,
  editedAddressField,
  modeChangeConfirmation,
  planModeChange,
  portModeOptions,
  sharedSubNetError,
  type PortEnableState,
  type PortMode,
} from '../node-config/port-rules';
import { useCommandRunner } from '../node-config/use-node-context';
import ConfirmBox from '../node-config/ConfirmBox.vue';
import PortAddressEditor from '../node-config/PortAddressEditor.vue';
import InfoTip from './InfoTip.vue';
import type { PortEntry } from './use-port-entries';

const props = defineProps<{
  entry: PortEntry;
  /** Live node; null while it does not answer. */
  node: NodeState | null;
  backend: ArtNetBackend;
  /** RDM `PORTn_ENABLED` of this port. */
  enable: PortEnableState;
  /** Writes `PORTn_ENABLED` (and reads it back). */
  setEnabled: (enabled: boolean) => Promise<void>;
  /** Bridge connected and node present. */
  online: boolean;
}>();
const emit = defineEmits<{ universe: [universe: number] }>();

const Select = useReplaceable('pm.select');
const Toggle = useReplaceable('pm.toggle');
const runner = useCommandRunner();
const { busy, error } = runner;

/** Mode the user picked that waits for confirmation. */
const pendingMode = ref<PortMode | null>(null);

const port = computed<PortState | null>(() => props.entry.state);
const current = computed(() => (port.value ? currentPortMode(port.value, props.enable) : null));
const modes = computed(() => (props.node && port.value ? portModeOptions(props.node, port.value, props.enable).map(m => ({ value: m, label: PORT_MODE_LABELS[m] })) : []));
const outputs = computed(() => current.value === 'output' || current.value === 'both');
const inputs = computed(() => current.value === 'input' || current.value === 'both');
const locked = computed(() => !props.online || busy.value !== null);
const confirmMessage = computed(() => (pendingMode.value && port.value && current.value
  ? modeChangeConfirmation(props.entry.label, port.value, current.value, pendingMode.value, props.node?.refreshRate ?? 0)
  : null));

/** Sends one ArtAddress change of this port. */
function writePort(key: string, change: Omit<ArtAddressPortChange, 'port'>) {
  const node = props.node;
  if (!node) return Promise.resolve(false);
  return runner.run(key, () => props.backend.request('artAddress', { nodeId: node.nodeId, ports: [{ port: { ...props.entry.port }, ...change }] }));
}

/** User picked a mode: ask first when data would stop. */
function chooseMode(value: string) {
  const target = value as PortMode;
  if (!port.value || !current.value || target === current.value) return;
  if (modeChangeConfirmation(props.entry.label, port.value, current.value, target, props.node?.refreshRate ?? 0)) pendingMode.value = target;
  else void applyMode(target);
}

/** Runs the requests of a mode change in order. */
async function applyMode(target: PortMode) {
  const node = props.node;
  const state = port.value;
  if (!node || !state) return;
  const steps = planModeChange(state, props.enable, target);
  await runner.run('mode', async () => {
    for (const step of steps) {
      if (step.kind === 'direction') {
        await props.backend.request('artAddress', { nodeId: node.nodeId, ports: [{ port: { ...state.port }, direction: step.direction }] });
      }
      else if (step.kind === 'rdmEnabled') await props.setEnabled(step.enabled);
      else {
        // ArtInput carries one flag per port of the BindIndex: the others keep theirs.
        const disabled = node.ports.filter(p => p.port.bind === state.port.bind).sort((a, b) => a.port.index - b.port.index)
          .map(p => (p.port.index === state.port.index ? step.disabled : p.input.disabled));
        await props.backend.request('artInput', { nodeId: node.nodeId, bind: state.port.bind, disabled });
      }
    }
  });
  pendingMode.value = null;
}

/** Writes the staged Port-Address (the field of the current direction). */
function writeAddress(portAddress: number) {
  if (!port.value) return;
  const change: Omit<ArtAddressPortChange, 'port'> = editedAddressField(port.value) === 'inputPortAddress' ? { inputPortAddress: portAddress } : { outputPortAddress: portAddress };
  void writePort('address', change);
}

/** Checks a staged Port-Address against the shared Net/Sub-Net of the BindIndex. */
function validateAddress(portAddress: number): string | null {
  return props.node ? sharedSubNetError(props.node, props.entry.port, portAddress) : null;
}

/** Parses the universe field (empty / invalid = off). */
function setUniverse(raw: string) {
  const n = Math.floor(Number(raw));
  emit('universe', Number.isFinite(n) && n > 0 ? Math.min(n, 32768) : 0);
}

/** Classes of the labels column and the universe input. */
const LABEL = 'flex w-24 shrink-0 items-center gap-1 text-muted-foreground';
const INPUT = 'w-16 rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring';
</script>

<template>
  <div class="flex flex-col gap-1 text-xs" data-port-essentials>
    <div v-if="port && current" class="flex min-h-7 items-center gap-2">
      <span :class="LABEL">Direction <InfoTip topic="direction" /></span>
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
    <div v-if="entry.outputIndex >= 0" class="flex min-h-7 items-center gap-2" data-universe-row>
      <span :class="LABEL">Universe <InfoTip topic="universeMapping" /></span>
      <input
        type="number"
        min="0"
        max="32768"
        placeholder="off"
        :class="INPUT"
        :value="entry.universe || ''"
        aria-label="Pixelmapper universe"
        data-universe
        @change="setUniverse(($event.target as HTMLInputElement).value)"
      >
      <span
        v-if="entry.differs"
        class="ml-auto text-[10px] text-muted-foreground"
        :title="`The node's Port-Address ${entry.portAddress} differs from U${entry.universe}. DMX still reaches the port; change the Port-Address if other Art-Net software should see the same number.`"
        data-differs
      >
        ≠ Port-Address {{ formatPortAddress(entry.portAddress!) }}
      </span>
    </div>
    <div v-if="port" class="flex items-start gap-2">
      <span :class="[LABEL, 'min-h-6']">Port-Address <InfoTip topic="portAddress" /></span>
      <PortAddressEditor
        class="flex-1"
        :model-value="entry.portAddress ?? 0"
        :disabled="!online || (busy !== null && busy !== 'address')"
        :busy="busy === 'address'"
        :validate="validateAddress"
        @write="writeAddress"
      />
    </div>
    <p v-if="port && node?.status.portAddressAuthority === 'panel'" class="text-[10px] text-muted-foreground">
      The node's addresses are set at its front panel; it may ignore changes from the network.
    </p>
    <div v-if="port && outputs" class="flex min-h-7 items-center gap-2">
      <span :class="LABEL">RDM <InfoTip topic="rdm" /></span>
      <div class="ml-auto flex" data-rdm>
        <component :is="Toggle" v-if="node?.status.rdmSwitchable" :model-value="port.output.rdm" :disabled="locked" size="sm" @update:model-value="(v: boolean) => writePort('rdm', { rdm: v })" />
        <span v-else class="text-muted-foreground">{{ port.output.rdm ? 'On' : 'Off' }}</span>
      </div>
    </div>
    <p v-if="port && outputs && port.output.shortCircuit" class="text-[10px] text-destructive">The node detected a short circuit on the DMX line.</p>
    <p v-if="port && inputs" class="text-[10px] text-muted-foreground">
      {{ port.input.data ? 'Receiving DMX' : 'No input signal' }}<template v-if="port.input.errors"> · receive errors</template>
    </p>
    <p v-if="!port" class="text-[11px] text-muted-foreground">The node is offline. Its port settings can be changed when it answers again.</p>
    <p v-if="error" class="text-[10px] text-destructive">{{ error }}</p>
  </div>
</template>

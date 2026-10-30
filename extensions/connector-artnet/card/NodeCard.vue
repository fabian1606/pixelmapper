<script setup lang="ts">
/**
 * The Art-Net card of a discovered node (WP13), top to bottom:
 *
 * 1. Header — name, IP, identity, firmware, status chips, Identify.
 * 2. Failsafe — one mode for all ports, or “Custom per port”.
 * 3. Ports — toolbar (Add all, Auto-address, Update tubes…) and one flat,
 *    collapsible block per port with its essentials, its RDM devices and
 *    its advanced settings (`NodePortBlock`).
 * 4. Network, Device, Advanced — collapsed sections.
 *
 * Ports are open by default when the node has at most two; every block's
 * open state is remembered per connector. The node's RDM description,
 * `PORTn_ENABLED` and the node-change signal are read once here and shared
 * by all blocks. A click on a device row opens the device dialog.
 */
import { computed, ref } from 'vue';
import type { RdmUid } from '../bridge/protocol-model';
import { samePort } from '../bridge/protocol-model';
import { getDeviceRuntime, type DeviceRuntime } from '../devices/device-runtime';
import { useDeviceActions } from '../devices/use-device-actions';
import { useDeviceList } from '../devices/use-device-list';
import { deviceStoreTubeReader } from '../firmware/device-store-reader';
import { getFirmwareUpdateManager } from '../firmware/firmware-update-manager';
import { isItemPending } from '../firmware/flash-item';
import { failsafePorts, sharedFailsafe } from '../node-config/port-rules';
import { useNodeChangeSignal } from '../node-config/use-node-change-signal';
import { provideNodeDescription, useNodeContext } from '../node-config/use-node-context';
import { usePortEnabled } from '../node-config/use-port-enabled';
import type { ArtNetNodeConnector } from '../node/node-connector';
import { RDM_SETTINGS_REREAD_MS } from '../rdm/parameter-form/use-rdm-parameter-form';
import DeviceDialog from '../components/DeviceDialog.vue';
import FirmwareUpdateDialog from '../firmware/FirmwareUpdateDialog.vue';
import NodeAdvancedSection from '../node-config/NodeAdvancedSection.vue';
import NodeDeviceSection from '../node-config/NodeDeviceSection.vue';
import NodeNetworkSection from '../node-config/NodeNetworkSection.vue';
import CardSection from './CardSection.vue';
import FailsafeGroup from './FailsafeGroup.vue';
import InfoTip from './InfoTip.vue';
import NodeCardHeader from './NodeCardHeader.vue';
import NodePortBlock from './NodePortBlock.vue';
import { PORTS_OPEN_BY_DEFAULT_MAX, provideCardCollapse } from './use-card-collapse';
import { useNodeIdentify } from './use-node-identify';
import { usePortEntries, type PortEntry } from './use-port-entries';

const props = defineProps<{
  connector: ArtNetNodeConnector;
  /** Device runtime to use (tests); default the app's. */
  runtime?: DeviceRuntime | null;
}>();
const emit = defineEmits<{ change: [patch: Record<string, unknown>] }>();

provideCardCollapse(props.connector.id);

// ── Node ────────────────────────────────────────

const { backend, directory } = props.connector.deps;
/** The node's id (after an add by IP: from its first reply). */
const nodeId = computed(() => props.connector.nodeId.value ?? props.connector.node.value?.nodeId ?? '');
const ctx = useNodeContext({ get nodeId() { return nodeId.value; }, backend, directory });
const { node, connected, online } = ctx;
const desc = provideNodeDescription(ctx);
/** Goes up when the node changed: RDM-only settings are read again. */
const nodeChanges = useNodeChangeSignal(() => node.value);
const enabled = usePortEnabled(backend, desc, RDM_SETTINGS_REREAD_MS, nodeChanges);
const identify = useNodeIdentify(ctx, () => nodeId.value);

/** RDM responder of a Pixelmapper Node (per-port PIDs), else null. */
const rdm = computed(() => {
  const address = desc.address.value;
  const description = desc.description.value;
  return desc.pixelmapperNode.value && address && description ? { address, description } : null;
});

// ── Ports and devices ──────────────────────────

const entries = usePortEntries(props.connector);
const portsOpen = computed(() => entries.value.length <= PORTS_OPEN_BY_DEFAULT_MAX);

/**
 * RDM devices and tube firmware: when the node reports RDM support
 * (Status1). While a known node is offline its devices stay listed.
 */
const rdmSupported = computed(() => (node.value ? node.value.status.rdmCapable : !!nodeId.value));
const runtime = props.runtime ?? getDeviceRuntime();
const deviceList = runtime ? useDeviceList(runtime, () => nodeId.value || null) : null;
const actions = useDeviceActions(runtime, () => nodeId.value || null);
const rows = computed(() => deviceList?.rows.value ?? []);

/** Devices of one port. */
const devicesOf = (e: PortEntry) => rows.value.filter(r => samePort(r.port, e.port));
/** The port answered TodNak. */
const noRdmOn = (e: PortEntry) => !!deviceList?.noRdmPorts.value.some(p => samePort(p.port, e.port));

/** New devices of all ports (toolbar Add all). */
const addable = computed(() => rows.value.filter(r => r.canAdd));
/** True when Auto-address has something to do. */
const hasLinked = computed(() => rows.value.some(r => r.fixtureId !== null && r.entry.present));
const nodeSummary = computed(() => (actions.summary.value?.scope === 'node' ? actions.summary.value : null));

/** Sets the universe of output `index` (0 = off). */
function setUniverse(index: number, universe: number) {
  const mapping = props.connector.outputMapping.value.slice();
  mapping[index] = universe;
  emit('change', { outputMapping: mapping });
}

/** Device whose dialog is open. */
const openUid = ref<RdmUid | null>(null);

// ── Failsafe ───────────────────────────────────

/** The user's choice of “Custom per port”; null = derived from the node. */
const failsafeChoice = ref<boolean | null>(null);
/** Custom when the user chose it, else when the node's ports differ. */
const failsafeCustom = computed(() => failsafeChoice.value ?? (node.value ? sharedFailsafe(node.value) === 'mixed' : false));
const showFailsafe = computed(() => !!node.value && failsafePorts(node.value).length > 0);

// ── Firmware ───────────────────────────────────

/** “Update tubes…” dialog open. */
const firmwareOpen = ref(false);
const manager = getFirmwareUpdateManager(backend);
/** Tube readings from the device store (no extra RDM GETs when the dialog opens). */
const readTube = deviceStoreTubeReader(runtime?.store ?? null, backend);
/** `Updating 2 tubes` while updates of this node are queued or running. */
const firmwareStatus = computed(() => {
  const id = nodeId.value;
  const pending = id ? manager.items.value.filter(i => i.nodeId === id && isItemPending(i)).length : 0;
  return pending ? `Updating ${pending} ${pending === 1 ? 'tube' : 'tubes'}` : null;
});

/** The node answers at a new address after a network change: follow it. */
function follow(target: { nodeId: string; ip: string }) {
  emit('change', { nodeId: target.nodeId, ip: target.ip });
}

/** Classes of the toolbar buttons. */
const BUTTON = 'px-1.5 py-0.5 rounded border transition-colors text-[11px] disabled:opacity-50';
</script>

<template>
  <div class="flex flex-col gap-2" data-node-card>
    <NodeCardHeader :connector="connector" :identify="nodeId ? identify : null" :online="online" />
    <p v-if="!connected" class="text-[11px] text-muted-foreground">Connect the Art-Net bridge to configure the node.</p>

    <FailsafeGroup v-if="showFailsafe && node" :node="node" :backend="backend" :online="online" :custom="failsafeCustom" @update:custom="failsafeChoice = $event" />

    <section class="flex flex-col" data-ports>
      <div class="flex min-h-7 flex-wrap items-center gap-1 text-xs">
        <span class="font-medium">Ports</span>
        <span v-if="rdmSupported" class="ml-auto flex flex-wrap items-center justify-end gap-1" data-port-toolbar>
          <template v-if="runtime">
            <button
            type="button"
            :class="[BUTTON, 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20']"
            :disabled="actions.nodeBusy.value || !addable.length"
            :title="addable.length ? `Add ${addable.length} devices with their current address and mode (one undo step)` : 'No new devices'"
            data-add-all
            @click="actions.add(addable.map(r => r.uid))"
          >
            Add all
          </button>
          <button
            type="button"
            :class="[BUTTON, 'border-border hover:bg-accent']"
            :disabled="actions.nodeBusy.value || !hasLinked"
            title="Re-address all linked devices of this node gap-free in canvas order"
            data-auto-address
            @click="actions.autoAddressNode()"
          >
            Auto-address
          </button>
            <InfoTip topic="autoAddress" />
          </template>
          <button
            type="button"
            :class="[BUTTON, 'border-border hover:bg-accent']"
            :disabled="!nodeId"
            title="Write a firmware image to the tubes on this node's ports"
            data-update-tubes
            @click="firmwareOpen = true"
          >
            Update tubes…
          </button>
          <InfoTip topic="firmwareUpdate" />
        </span>
      </div>
      <p v-if="firmwareStatus" class="text-[10px] tabular-nums text-muted-foreground">{{ firmwareStatus }}</p>
      <p v-if="nodeSummary" class="text-[11px]" :class="nodeSummary.error ? 'text-destructive' : 'text-muted-foreground'">{{ nodeSummary.text }}</p>
      <p v-if="rdmSupported && !runtime" class="text-[11px] text-muted-foreground">Device discovery is not active.</p>
      <NodePortBlock
        v-for="e in entries"
        :key="e.key"
        :entry="e"
        :node="node"
        :backend="backend"
        :enable="enabled.stateOf(e.port)"
        :set-enabled="(v: boolean) => enabled.write(e.port, v)"
        :online="online"
        :rdm="rdm"
        :reread-on="nodeChanges"
        :devices="devicesOf(e)"
        :no-rdm="noRdmOn(e)"
        :actions="rdmSupported && runtime ? actions : null"
        :failsafe-custom="failsafeCustom"
        :default-open="portsOpen"
        @universe="setUniverse(e.outputIndex, $event)"
        @open="openUid = $event"
      />
    </section>

    <div v-if="nodeId" class="flex flex-col border-t border-border/50 pt-1">
      <CardSection section-id="network" title="Network" :hint="node?.ip">
        <NodeNetworkSection :node-id="nodeId" :backend="backend" :directory="directory" @follow="follow" />
      </CardSection>
      <CardSection section-id="device" title="Device" :hint="node?.shortName || undefined">
        <NodeDeviceSection :node-id="nodeId" :backend="backend" :directory="directory" />
      </CardSection>
      <CardSection section-id="advanced" title="Advanced" info="nodeAdvanced" :hint="node?.uid ? 'RDM' : undefined">
        <NodeAdvancedSection :node-id="nodeId" :backend="backend" :directory="directory" />
      </CardSection>
    </div>

    <FirmwareUpdateDialog v-if="nodeId && rdmSupported" v-model:open="firmwareOpen" :node-id="nodeId" :backend="backend" :manager="manager" :read-tube="readTube" />
    <DeviceDialog
      v-if="openUid"
      :open="!!openUid"
      :uid="openUid"
      :runtime="runtime"
      @update:open="(v: boolean) => { if (!v) openUid = null; }"
      @add="openUid && actions.add([openUid])"
    />
  </div>
</template>

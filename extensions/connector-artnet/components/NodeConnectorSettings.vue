<script setup lang="ts">
/**
 * Settings of an `artnet-node` connector (plan M5.3/M5.5, M6.1, M7.3,
 * M7.4): bridge hint, node picker while no node is chosen, else the node
 * summary, the port mapping (the type sets `ownsOutputMapping`, so the card
 * shows no generic Outputs section), the RDM devices on the node's ports,
 * “Update tubes…” (batch firmware update of the node's tubes) and the node
 * configuration (Ports, Network, Device, Advanced).
 *
 * The node's Port-Addresses are written only in the configuration's Ports
 * section; the port mapping shows them read-only.
 *
 * What the connector learns from the network (node id after an add by IP,
 * new IP, changed output ports) is persisted by the connector itself
 * (`connectors.persist`, API 1.4), also while this card is closed.
 */
import { computed, ref } from 'vue';
import type { NodeId } from '../bridge/protocol-model';
import { getArtNetBackend } from '../bridge/shared';
import { getDeviceRuntime } from '../devices/device-runtime';
import { deviceStoreTubeReader } from '../firmware/device-store-reader';
import { getFirmwareUpdateManager } from '../firmware/firmware-update-manager';
import { isItemPending } from '../firmware/flash-item';
import type { ArtNetNodeConnector } from '../node/node-connector';
import FirmwareUpdateDialog from '../firmware/FirmwareUpdateDialog.vue';
import NodeConfigPanel from '../node-config/NodeConfigPanel.vue';
import BridgeStatusHint from './BridgeStatusHint.vue';
import DeviceDiscoveryList from './DeviceDiscoveryList.vue';
import NodePicker from './NodePicker.vue';
import NodePortTable from './NodePortTable.vue';
import NodeSummary from './NodeSummary.vue';

const props = defineProps<{ connector: ArtNetNodeConnector }>();
const emit = defineEmits<{ change: [patch: Record<string, unknown>] }>();

/** True once the connector knows which node it drives. */
const bound = computed(() => !!props.connector.nodeId.value || !!props.connector.ip.value);
/** The node's id, once known (after an add by IP it follows the first reply). */
const nodeId = computed<NodeId | null>(() => props.connector.nodeId.value);

/** “Update tubes…” dialog open. */
const firmwareOpen = ref(false);
const backend = getArtNetBackend();
const manager = getFirmwareUpdateManager(backend);
/** Tube readings from the device store (no extra RDM GETs when the dialog opens). */
const readTube = deviceStoreTubeReader(getDeviceRuntime()?.store ?? null, backend);

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
</script>

<template>
  <div class="flex flex-col gap-2">
    <BridgeStatusHint compact />
    <NodePicker v-if="!bound" :connector="connector" @change="emit('change', $event)" />
    <template v-else>
      <NodeSummary :connector="connector" />
      <NodePortTable :connector="connector" @change="emit('change', $event)" />
      <DeviceDiscoveryList :connector="connector" />
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="px-1.5 py-0.5 rounded border border-border hover:bg-accent transition-colors text-[11px] disabled:opacity-50"
          :disabled="!nodeId"
          title="Write a firmware image to the tubes on this node's ports"
          data-update-tubes
          @click="firmwareOpen = true"
        >
          Update tubes…
        </button>
        <span v-if="firmwareStatus" class="text-[10px] text-muted-foreground tabular-nums">{{ firmwareStatus }}</span>
      </div>
      <FirmwareUpdateDialog v-if="nodeId" v-model:open="firmwareOpen" :node-id="nodeId" :backend="backend" :manager="manager" :read-tube="readTube" />
      <NodeConfigPanel v-if="nodeId" :node-id="nodeId" @follow="follow" />
    </template>
  </div>
</template>

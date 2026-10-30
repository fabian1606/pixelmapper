<script setup lang="ts">
/**
 * Settings card of an `artnet` connector (plan M5.3/M5.5, M6.1, M7.3,
 * M7.4; layout WP13): the bridge hint, then
 *
 * - the device picker while no device is chosen,
 * - the manual target's outputs (`ManualTargetPorts`) while a device added
 *   by IP has never answered ArtPoll,
 * - else the node card (`NodeCard`: header, failsafe, ports with their
 *   devices, network, device, advanced). The type sets `ownsOutputMapping`,
 *   so the host shows no generic Outputs section.
 *
 * What the connector learns from the network (node id after an add by IP,
 * new IP, changed output ports) is persisted by the connector itself
 * (`connectors.persist`, API 1.4), also while this card is closed.
 */
import { computed } from 'vue';
import type { DeviceRuntime } from '../devices/device-runtime';
import type { ArtNetNodeConnector } from '../node/node-connector';
import NodeCard from '../card/NodeCard.vue';
import BridgeStatusHint from './BridgeStatusHint.vue';
import ManualTargetPorts from './ManualTargetPorts.vue';
import NodePicker from './NodePicker.vue';

const props = defineProps<{
  connector: ArtNetNodeConnector;
  /** Device runtime to use (tests); default the app's. */
  runtime?: DeviceRuntime | null;
}>();
const emit = defineEmits<{ change: [patch: Record<string, unknown>] }>();

/** True once the connector knows which node it drives. */
const bound = computed(() => !!props.connector.nodeId.value || !!props.connector.ip.value);
</script>

<template>
  <div class="flex flex-col gap-2">
    <BridgeStatusHint compact />
    <NodePicker v-if="!bound" :connector="connector" @change="emit('change', $event)" />
    <ManualTargetPorts v-else-if="connector.isManualTarget.value" :connector="connector" @change="emit('change', $event)" />
    <NodeCard v-else :connector="connector" :runtime="runtime" @change="emit('change', $event)" />
  </div>
</template>

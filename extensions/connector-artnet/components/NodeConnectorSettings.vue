<script setup lang="ts">
/**
 * Settings of an `artnet-node` connector (plan M5.3/M5.5): bridge hint,
 * node picker while no node is chosen, else the node summary and the port
 * mapping (the type sets `ownsOutputMapping`, so the card shows no generic
 * Outputs section).
 * Later milestones add sections here (device list M6, node configuration M7).
 *
 * What the connector learns from the network (node id after an add by IP,
 * new IP, changed output ports) is persisted by the connector itself
 * (`connectors.persist`, API 1.4), also while this card is closed.
 */
import { computed } from 'vue';
import type { ArtNetNodeConnector } from '../node/node-connector';
import BridgeStatusHint from './BridgeStatusHint.vue';
import NodePicker from './NodePicker.vue';
import NodePortTable from './NodePortTable.vue';
import NodeSummary from './NodeSummary.vue';

const props = defineProps<{ connector: ArtNetNodeConnector }>();
const emit = defineEmits<{ change: [patch: Record<string, unknown>] }>();

/** True once the connector knows which node it drives. */
const bound = computed(() => !!props.connector.nodeId.value || !!props.connector.ip.value);
</script>

<template>
  <div class="flex flex-col gap-2">
    <BridgeStatusHint compact />
    <NodePicker v-if="!bound" :connector="connector" @change="emit('change', $event)" />
    <template v-else>
      <NodeSummary :connector="connector" />
      <NodePortTable :connector="connector" @change="emit('change', $event)" />
    </template>
  </div>
</template>

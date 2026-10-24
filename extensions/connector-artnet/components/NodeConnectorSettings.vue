<script setup lang="ts">
/**
 * Settings of an `artnet-node` connector (plan M5.3/M5.5): bridge hint,
 * node picker while no node is chosen, else the node summary and the port
 * mapping.
 * Later milestones add sections here (device list M6, node configuration M7).
 *
 * What the connector learns from the network (node id after an add by IP,
 * new IP, changed output ports) is emitted as `change` so the host persists
 * it while the card is open.
 */
import { computed, onMounted, watch } from 'vue';
import type { ArtNetNodeConnector } from '../node/node-connector';
import BridgeStatusHint from './BridgeStatusHint.vue';
import NodePicker from './NodePicker.vue';
import NodePortTable from './NodePortTable.vue';
import NodeSummary from './NodeSummary.vue';

const props = defineProps<{ connector: ArtNetNodeConnector }>();
const emit = defineEmits<{ change: [patch: Record<string, unknown>] }>();

/** True once the connector knows which node it drives. */
const bound = computed(() => !!props.connector.nodeId.value || !!props.connector.ip.value);

/** The learned part of the config. */
function learned() {
  const c = props.connector.getConfig();
  return { label: c.label, nodeId: c.nodeId, ip: c.ip, ports: c.ports, outputCount: c.outputCount, outputMapping: c.outputMapping };
}

let lastSaved = '';
/** Emits the learned config when it differs from what was last emitted. */
function persistLearned() {
  const patch = learned();
  const json = JSON.stringify(patch);
  if (json === lastSaved) return;
  lastSaved = json;
  emit('change', patch);
}

onMounted(() => {
  persistLearned();
  watch(
    () => [props.connector.nodeId.value, props.connector.ip.value, props.connector.ports.value, props.connector.outputMapping.value, props.connector.label.value],
    persistLearned,
  );
});
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

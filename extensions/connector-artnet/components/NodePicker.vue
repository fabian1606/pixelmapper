<script setup lang="ts">
/**
 * Chooses the device of an `artnet` connector that was added without one
 * (the “+ Art-Net” button): a discovered device without a connector, or a
 * device IP (polled there; a manual target until it answers ArtPoll).
 * Emits the config patch; the host applies and persists it.
 */
import { computed } from 'vue';
import type { NodeState } from '../bridge/protocol-model';
import { formatNodeId } from '../bridge/protocol-model';
import { getNodeDirectory } from '../bridge/shared';
import { ArtNetNodeConnector, activeNodeConnectors } from '../node/node-connector';
import { unconnectedNodes } from '../node/suggestions';
import NodeAddByIp from './NodeAddByIp.vue';

const props = defineProps<{ connector: ArtNetNodeConnector }>();
const emit = defineEmits<{ change: [patch: Record<string, unknown>] }>();

const directory = getNodeDirectory();

/** Discovered nodes no other connector uses. */
const candidates = computed(() => unconnectedNodes(
  directory.list(),
  [...activeNodeConnectors].filter(c => c !== props.connector).map(c => ({ nodeId: c.nodeId.value, ip: c.ip.value })),
));

function pick(node: NodeState) {
  emit('change', ArtNetNodeConnector.configForNode(node));
}

function addIp(ip: string) {
  emit('change', ArtNetNodeConnector.configForIp(ip, props.connector.label.value || ip));
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <span class="text-xs text-muted-foreground">Choose the Art-Net device for this connector, or add it by IP:</span>
    <button
      v-for="node in candidates"
      :key="node.nodeId"
      class="flex items-center gap-2 px-2 py-1 rounded border border-border hover:bg-accent transition-colors text-left text-xs"
      @click="pick(node)"
    >
      <span class="font-medium truncate">{{ node.shortName || node.longName || formatNodeId(node.nodeId) }}</span>
      <span class="font-mono text-muted-foreground">{{ node.ip }}</span>
      <span class="ml-auto text-muted-foreground">{{ node.ports.filter(p => p.canOutput).length }} outputs</span>
    </button>
    <p v-if="!candidates.length" class="text-[11px] text-muted-foreground">No unconnected Art-Net devices found on the network.</p>
    <NodeAddByIp @add="addIp" />
  </div>
</template>

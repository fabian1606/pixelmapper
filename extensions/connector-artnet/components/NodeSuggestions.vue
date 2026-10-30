<script setup lang="ts">
/**
 * Art-Net device suggestions on the Connectors page, Outputs tab (plan M5.2;
 * slot `connections/outputs:before`): “Art-Net device found: <name> · <IP> —
 * Connect / Dismiss” for devices without a connector, manual add by IP
 * (also for devices that never answer ArtPoll: manual target), and the
 * bridge hint when the bridge is missing, outdated or unsupported.
 * Mounting it starts discovery (`retainArtNetDiscovery`), unmounting
 * releases it.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import { connectors } from '@pixelmapper/extension-api';
import type { NodeState } from '../bridge/protocol-model';
import { formatNodeId } from '../bridge/protocol-model';
import { getArtNetBackend, getNodeDirectory, retainArtNetDiscovery } from '../bridge/shared';
import { ArtNetNodeConnector, activeNodeConnectors } from '../node/node-connector';
import { suggestNodes, unconnectedNodes, useDismissedNodes } from '../node/suggestions';
import BridgeStatusHint from './BridgeStatusHint.vue';
import NodeAddByIp from './NodeAddByIp.vue';

// Discovery runs while the Connectors page shows this (and while node connectors exist).
const releaseDiscovery = retainArtNetDiscovery();
onBeforeUnmount(releaseDiscovery);
const backend = getArtNetBackend();
const directory = getNodeDirectory();
const { dismissed, dismiss, restore } = useDismissedNodes();

/** Nodes that already have a connector. */
const taken = computed(() => [...activeNodeConnectors].map(c => ({ nodeId: c.nodeId.value, ip: c.ip.value })));
const suggestions = computed(() => suggestNodes(directory.nodes.values(), taken.value, dismissed.value));
/** Dismissed nodes that are on the network right now. */
const hiddenIds = computed(() => unconnectedNodes(directory.nodes.values(), taken.value).filter(n => dismissed.value.has(n.nodeId)).map(n => n.nodeId));

const connected = computed(() => backend.state.value.kind === 'connected');
const addOpen = ref(false);
const error = ref<string | null>(null);

/** Adds a connector to the user's connector set (API 1.4); false when that fails. */
function addConnector(config: Record<string, unknown>): boolean {
  try {
    connectors.add(ArtNetNodeConnector.fromConfig(crypto.randomUUID(), config));
  }
  catch (err) {
    console.error('[artnet] cannot add the node connector:', err);
    error.value = 'Use “+ Art-Net” above and choose the device there.';
    return false;
  }
  error.value = null;
  return true;
}

function connect(node: NodeState) {
  addConnector(ArtNetNodeConnector.configForNode(node));
}

function addIp(ip: string) {
  if (addConnector(ArtNetNodeConnector.configForIp(ip))) addOpen.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-2 px-3 py-2.5 rounded border border-border bg-background text-sm">
    <div class="flex items-center gap-2">
      <span class="text-xs font-medium">Art-Net devices</span>
      <span v-if="connected" class="text-xs text-muted-foreground">
        {{ directory.nodes.size }} on the network
      </span>
      <button
        v-if="hiddenIds.length"
        class="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        @click="restore(hiddenIds)"
      >
        Show dismissed ({{ hiddenIds.length }})
      </button>
      <button
        class="ml-auto text-[11px] text-muted-foreground hover:text-foreground"
        @click="addOpen = !addOpen"
      >
        {{ addOpen ? 'Cancel' : 'Add by IP' }}
      </button>
    </div>

    <BridgeStatusHint compact />

    <div
      v-for="node in suggestions"
      :key="node.nodeId"
      class="flex items-center gap-2 text-xs"
    >
      <span class="flex-1 min-w-0 truncate">
        Art-Net device found: <span class="font-medium">{{ node.shortName || node.longName || formatNodeId(node.nodeId) }}</span>
        · <span class="font-mono">{{ node.ip }}</span>
      </span>
      <button
        class="shrink-0 px-2 py-1 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        @click="connect(node)"
      >
        Connect
      </button>
      <button
        class="shrink-0 px-2 py-1 rounded border border-border hover:bg-accent transition-colors"
        @click="dismiss(node.nodeId)"
      >
        Dismiss
      </button>
    </div>

    <NodeAddByIp v-if="addOpen" @add="addIp" />
    <p v-if="error" class="text-[11px] text-destructive">{{ error }}</p>
  </div>
</template>

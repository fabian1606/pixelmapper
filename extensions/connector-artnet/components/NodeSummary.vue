<script setup lang="ts">
/**
 * One-line facts about the node of an `artnet-node` connector: long name,
 * IP, identity (UID or MAC), firmware, indicator and node report.
 */
import { computed } from 'vue';
import { formatNodeId } from '../bridge/protocol-model';
import type { ArtNetNodeConnector } from '../node/node-connector';

const props = defineProps<{ connector: ArtNetNodeConnector }>();

const node = computed(() => props.connector.node.value);

/** Firmware as `major.minor` from VersInfo. */
const firmware = computed(() => (node.value ? `${node.value.firmware >> 8}.${node.value.firmware & 0xff}` : null));

/** Identity shown to the user (UID, MAC, or IP with the UDP port of a simulator). */
const identity = computed(() => {
  const n = node.value;
  if (n?.uid) return `UID ${n.uid}`;
  if (n?.mac) return `MAC ${n.mac}`;
  const id = n?.nodeId ?? props.connector.nodeId.value;
  return id ? formatNodeId(id) : null;
});
</script>

<template>
  <div class="flex flex-col gap-0.5 text-xs">
    <div class="flex items-center gap-2 min-w-0">
      <span class="font-medium truncate">{{ node?.longName || node?.shortName || connector.label.value || 'Art-Net node' }}</span>
      <span v-if="node?.status.indicator === 'locate'" class="text-[10px] px-1 rounded bg-primary/15 text-primary">Locating</span>
      <span v-if="node?.status.indicator === 'mute'" class="text-[10px] px-1 rounded bg-muted text-muted-foreground">Display off</span>
    </div>
    <div class="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground font-mono">
      <span v-if="node || connector.ip.value">{{ node?.ip ?? connector.ip.value }}<template v-if="!node"> (last known)</template></span>
      <span v-if="identity">{{ identity }}</span>
      <span v-if="firmware">FW {{ firmware }}</span>
    </div>
    <div v-if="node?.nodeReport" class="text-[10px] text-muted-foreground/80 truncate" :title="node.nodeReport">{{ node.nodeReport }}</div>
  </div>
</template>

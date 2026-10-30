<script setup lang="ts">
/**
 * Header of the Art-Net card (WP13): the node's name, IP, identity (UID,
 * MAC or IP with the UDP port of a simulator), firmware, status chips
 * (online/offline, locating, display off) and Identify of the node
 * (flashlight; ArtAddress LED Locate), plus the node report.
 */
import { computed } from 'vue';
import { formatNodeId } from '../bridge/protocol-model';
import type { ArtNetNodeConnector } from '../node/node-connector';
import IdentifyButton from '../inspector/IdentifyButton.vue';
import InfoTip from './InfoTip.vue';
import type { NodeIdentify } from './use-node-identify';

const props = defineProps<{
  connector: ArtNetNodeConnector;
  /** Identify of the node; null while the node id is unknown. */
  identify: NodeIdentify | null;
  /** Commands can be sent (bridge connected, node present). */
  online: boolean;
}>();

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

/**
 * NodeReport without its `[nnnn]` reply counter: the bridge sends no `node`
 * event for counter-only changes, so a shown counter would look frozen.
 */
const report = computed(() => node.value?.nodeReport.replace(/\s*\[\d+\]\s*/, ' ').trim() ?? '');
</script>

<template>
  <div class="flex flex-col gap-0.5 text-xs" data-card-header>
    <div class="flex min-w-0 items-center gap-2">
      <span class="truncate font-medium">{{ node?.longName || node?.shortName || connector.label.value || 'Art-Net device' }}</span>
      <span v-if="node" class="shrink-0 rounded bg-primary/15 px-1 text-[10px] text-primary">Online</span>
      <span v-else class="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground" data-offline>Offline</span>
      <span v-if="identify?.on.value" class="shrink-0 rounded bg-primary/15 px-1 text-[10px] text-primary">Locating</span>
      <span v-if="identify?.muted.value" class="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">Display off</span>
      <span v-if="identify" class="ml-auto flex shrink-0 items-center gap-1" data-node-identify>
        <button
          v-if="identify.muted.value"
          type="button"
          class="rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-accent disabled:opacity-50"
          :disabled="!online || identify.busy.value !== null"
          @click="identify.unmute()"
        >
          Turn display on
        </button>
        <IdentifyButton small :on="identify.on.value" :disabled="!online || identify.busy.value === 'identify'" @toggle="identify.set($event)" />
        <InfoTip topic="identifyNode" />
      </span>
    </div>
    <div class="flex flex-wrap gap-x-2 font-mono text-[11px] text-muted-foreground">
      <span v-if="node || connector.ip.value">{{ node?.ip ?? connector.ip.value }}<template v-if="!node"> (last known)</template></span>
      <span v-if="identity">{{ identity }}</span>
      <span v-if="firmware">FW {{ firmware }}</span>
    </div>
    <div v-if="report" class="truncate text-[10px] text-muted-foreground/80" :title="report">{{ report }}</div>
    <p v-if="identify?.error.value" class="text-[10px] text-destructive">{{ identify.error.value }}</p>
  </div>
</template>

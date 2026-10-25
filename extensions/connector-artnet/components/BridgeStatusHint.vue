<script setup lang="ts">
/**
 * Hint about the Art-Net bridge when it blocks Art-Net (plan M5.2):
 * unsupported browser (Safari), bridge not running (`pmnet-bridge serve`, download
 * link, Chrome local-network prompt), wrong version, UDP port taken.
 * Renders nothing while the bridge is connected and healthy.
 */
import { computed, ref } from 'vue';
import { DEFAULT_BRIDGE_URL, PMNET_DOWNLOAD_URL, PMNET_SERVE_COMMAND, getArtNetBackend, getBridgeUrl, setBridgeUrl } from '../bridge/shared';
import { backendProblem } from '../node/node-status';

const props = withDefaults(defineProps<{
  /** Start with the details (download, URL) collapsed. */
  compact?: boolean;
}>(), { compact: false });

const backend = getArtNetBackend();
const state = backend.state;
const detailsOpen = ref(!props.compact);
const url = ref(getBridgeUrl());

/** Main line of the hint, or null when there is nothing to say. */
const message = computed(() => {
  const s = state.value;
  if (s.kind === 'connecting') return 'Connecting to the Art-Net bridge…';
  if (s.kind === 'connected') return s.info.udp.bound ? null : `The bridge cannot open UDP port ${s.info.udp.port}${s.info.udp.error ? ` (${s.info.udp.error})` : ''} — close other Art-Net software.`;
  return backendProblem(s);
});

/** Details are useful when the user has to install, start or update the bridge. */
const actionable = computed(() => state.value.kind === 'unreachable' || state.value.kind === 'incompatible');

/** Stores the bridge URL and reconnects. */
function applyUrl() {
  setBridgeUrl(url.value);
  url.value = getBridgeUrl();
}
</script>

<template>
  <div
    v-if="message"
    class="rounded border px-2 py-1.5 text-[11px] leading-snug flex flex-col gap-1"
    :class="state.kind === 'connecting' ? 'border-border text-muted-foreground' : 'border-primary/40 bg-primary/5 text-foreground'"
  >
    <div class="flex items-start gap-2">
      <span class="flex-1">{{ message }}</span>
      <button
        v-if="actionable"
        class="shrink-0 px-1.5 py-0.5 rounded border border-border hover:bg-accent transition-colors"
        @click="backend.reconnectNow()"
      >
        Retry
      </button>
      <button
        v-if="actionable"
        class="shrink-0 px-1 text-muted-foreground hover:text-foreground"
        @click="detailsOpen = !detailsOpen"
      >
        {{ detailsOpen ? 'Less' : 'How?' }}
      </button>
    </div>
    <div v-if="actionable && detailsOpen" class="flex flex-col gap-1 text-muted-foreground">
      <p>
        Art-Net needs the local bridge <span class="font-mono">pmnet-bridge</span>. Start it in a terminal:
        <span class="font-mono text-foreground select-all">{{ PMNET_SERVE_COMMAND }}</span>
      </p>
      <p>
        <a v-if="PMNET_DOWNLOAD_URL" :href="PMNET_DOWNLOAD_URL" target="_blank" rel="noopener" class="underline hover:text-foreground">Download pmnet-bridge</a>
        <span v-else>pmnet-bridge download: the link follows with the first release.</span>
        Chrome may ask to allow access to devices on your local network — allow it.
      </p>
      <label class="flex items-center gap-1.5">
        Bridge URL
        <input
          v-model="url"
          type="text"
          class="flex-1 min-w-0 rounded border border-border bg-background text-[11px] font-mono px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
          :placeholder="DEFAULT_BRIDGE_URL"
          @change="applyUrl"
        >
      </label>
    </div>
  </div>
</template>

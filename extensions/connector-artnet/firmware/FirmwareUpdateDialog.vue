<script setup lang="ts">
/**
 * Tube firmware update dialog (plan M7.4, D17): batch per node ("Update
 * tubes…" in the node's connector card) or one tube (`uids` with one UID,
 * from the fixture inspector via `TubeFirmwareButton`).
 *
 * Usage: `<FirmwareUpdateDialog v-model:open="open" :node-id="nodeId" />`
 *
 * Teleported to `<body>` and styled like the app's dialog (extensions may
 * not import the app's UI components). The root carries
 * `data-overlay-root`, so clicks inside it do not close the properties
 * sidebar it may be opened from (`FLOATING_OVERLAY_SELECTORS`). Closing
 * does not stop running updates.
 */
import { computed, onBeforeUnmount, watch } from 'vue';
import type { ArtNetBackend } from '../bridge/backend';
import type { NodeId, RdmUid } from '../bridge/protocol-model';
import { getNodeDirectory } from '../bridge/shared';
import type { FirmwareUpdateManager } from './firmware-update-manager';
import type { TubeDirectory, TubeReader } from './tube-devices';
import FirmwareUpdatePanel from './FirmwareUpdatePanel.vue';

const props = withDefaults(defineProps<{
  /** Visible (`v-model:open`). */
  open: boolean;
  /** Node whose tubes are offered. */
  nodeId: NodeId;
  /** Only these tubes (inspector: one UID). */
  uids?: RdmUid[];
  /** Heading; default `Update tube firmware`. */
  title?: string;
  /** Default: the app-wide bridge connection. */
  backend?: ArtNetBackend;
  /** Default: the app-wide node directory. */
  directory?: TubeDirectory;
  /** Default: the manager of `backend`. */
  manager?: FirmwareUpdateManager;
  /** How a tube's firmware is read (tests, cached device info). */
  readTube?: TubeReader;
}>(), { uids: undefined, title: 'Update tube firmware', backend: undefined, directory: undefined, manager: undefined, readTube: undefined });

const emit = defineEmits<{
  'update:open': [open: boolean];
  /** Updates were queued. */
  'started': [count: number];
}>();

const directory = computed(() => props.directory ?? getNodeDirectory());
/** `PM Node · 2.27.44.61`, or the node id while the node is unknown. */
const nodeLabel = computed(() => {
  const node = directory.value.getNode(props.nodeId);
  return node ? `${node.shortName || node.longName} · ${node.ip}` : props.nodeId;
});

/** Closes the dialog. */
function close() {
  emit('update:open', false);
}

/** Escape closes (running updates continue). */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    close();
  }
}

watch(() => props.open, (open) => {
  if (open) window.addEventListener('keydown', onKeydown);
  else window.removeEventListener('keydown', onKeydown);
}, { immediate: true });
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      data-overlay-root
      class="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 animate-in fade-in-0"
      @click.self="close"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pm-firmware-update-title"
        class="relative grid w-full max-w-[calc(100%-2rem)] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 animate-in fade-in-0 zoom-in-95 sm:max-w-xl"
      >
        <div class="flex flex-col gap-1 pr-6">
          <h2 id="pm-firmware-update-title" class="text-lg font-semibold leading-none">{{ title }}</h2>
          <p class="text-xs text-muted-foreground">{{ nodeLabel }}</p>
        </div>
        <button
          type="button"
          class="absolute right-4 top-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:outline-hidden"
          aria-label="Close"
          data-close
          @click="close"
        >
          <!-- "x" icon -->
          <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <FirmwareUpdatePanel
          :node-id="nodeId"
          :uids="uids"
          :backend="backend"
          :directory="directory"
          :manager="manager"
          :read-tube="readTube"
          @started="emit('started', $event)"
        />
      </div>
    </div>
  </Teleport>
</template>

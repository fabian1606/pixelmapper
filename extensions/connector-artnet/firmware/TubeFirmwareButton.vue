<script setup lang="ts">
/**
 * "Update firmware…" for one tube (plan M7.4, D18: RDM section of the
 * fixture inspector). Opens `FirmwareUpdateDialog` limited to the tube's
 * UID and shows the state of a running update next to the button.
 *
 * Usage: `<TubeFirmwareButton :node-id="link.nodeId" :uid="link.uid" />`
 */
import { computed, ref } from 'vue';
import type { ArtNetBackend } from '../bridge/backend';
import type { NodeId, RdmUid } from '../bridge/protocol-model';
import { getArtNetBackend } from '../bridge/shared';
import { getFirmwareUpdateManager, type FirmwareUpdateManager } from './firmware-update-manager';
import { flashProgressFraction } from './flash-progress';
import { isItemPending } from './flash-item';
import type { TubeDirectory, TubeReader } from './tube-devices';
import FirmwareUpdateDialog from './FirmwareUpdateDialog.vue';

const props = withDefaults(defineProps<{
  /** Node the tube is connected to. */
  nodeId: NodeId;
  uid: RdmUid;
  /** Button text. */
  label?: string;
  backend?: ArtNetBackend;
  directory?: TubeDirectory;
  manager?: FirmwareUpdateManager;
  readTube?: TubeReader;
}>(), { label: 'Update firmware…', backend: undefined, directory: undefined, manager: undefined, readTube: undefined });

const open = ref(false);
const manager = computed(() => props.manager ?? getFirmwareUpdateManager(props.backend ?? getArtNetBackend()));
const uids = computed(() => [props.uid]);

/** `Updating · 42 %` / `Waiting…` while an update of this tube is pending. */
const status = computed(() => {
  const item = manager.value.latest(props.uid);
  if (!item || !isItemPending(item)) return null;
  if (item.status === 'queued') return 'Waiting for the port';
  if (item.status === 'cancelling') return 'Cancelling…';
  return item.job ? `Updating · ${Math.round(flashProgressFraction(item.job) * 100)} %` : 'Starting update…';
});
</script>

<template>
  <div class="flex items-center gap-2">
    <button
      type="button"
      class="inline-flex h-7 items-center justify-center rounded-md border border-border px-2.5 text-xs font-medium transition-colors hover:bg-accent"
      data-open-firmware
      @click="open = true"
    >
      {{ label }}
    </button>
    <span v-if="status" class="text-[11px] text-muted-foreground tabular-nums" data-firmware-status>{{ status }}</span>
    <FirmwareUpdateDialog
      v-model:open="open"
      :node-id="nodeId"
      :uids="uids"
      :backend="backend"
      :directory="directory"
      :manager="manager"
      :read-tube="readTube"
    />
  </div>
</template>

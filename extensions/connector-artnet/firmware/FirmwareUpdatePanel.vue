<script setup lang="ts">
/**
 * Body of the firmware update dialog (plan M7.4): pick a `.hex` file →
 * preview of its trailer (model, version) → the node's tubes with version
 * old → new, preselected when newer, greyed with the reason when not
 * offered → confirm downgrades → run, with progress, phase and error per
 * tube, and cancel.
 *
 * The updates run in the app-wide `FirmwareUpdateManager`; closing the
 * dialog does not stop them, reopening shows them again.
 */
import { computed, ref } from 'vue';
import type { ArtNetBackend } from '../bridge/backend';
import type { NodeId, RdmUid } from '../bridge/protocol-model';
import type { FirmwareUpdateManager } from './firmware-update-manager';
import { describeImageModel } from './firmware-version';
import type { TubeDirectory, TubeReader } from './tube-devices';
import { useFirmwareUpdate, type FirmwareCandidate } from './use-firmware-update';
import FirmwareUpdateRow from './FirmwareUpdateRow.vue';

const props = defineProps<{
  nodeId: NodeId;
  /** Only these tubes (inspector: one UID). */
  uids?: RdmUid[];
  backend?: ArtNetBackend;
  directory?: TubeDirectory;
  manager?: FirmwareUpdateManager;
  readTube?: TubeReader;
}>();

const emit = defineEmits<{
  /** Updates were queued. */
  started: [count: number];
}>();

const fw = useFirmwareUpdate({
  nodeId: () => props.nodeId,
  uids: () => props.uids,
  backend: props.backend,
  directory: props.directory,
  manager: props.manager,
  readTube: props.readTube,
});
const { connected, fileName, image, imageError, loadingImage, candidates, readingTubes, selected, running, summary } = fw;

const fileInput = ref<HTMLInputElement | null>(null);
/** Selected downgrades waiting for confirmation; null = not asking. */
const confirming = ref<FirmwareCandidate[] | null>(null);

/** Takes the first file of a file list. */
function takeFile(files: FileList | null | undefined) {
  const file = files?.[0];
  if (!file) return;
  confirming.value = null;
  void fw.chooseFile(file);
}

/** File input changed. */
function onFileInput(event: Event) {
  const input = event.target as HTMLInputElement;
  takeFile(input.files);
  input.value = ''; // choosing the same file again reloads it
}

/** Starts the update (asks first when downgrades are selected). */
function startUpdate(confirmDowngrade = false) {
  const result = fw.start({ confirmDowngrade });
  if (result.needsConfirmation.length) {
    confirming.value = result.needsConfirmation;
    return;
  }
  confirming.value = null;
  if (result.started) emit('started', result.started);
}

/** Selectable rows (for "select all"). */
const selectable = computed(() => candidates.value.filter(c => c.selectable));
const allSelected = computed(() => selectable.value.length > 0 && selectable.value.every(c => c.selected));

/** Footer summary, e.g. `2 updated · 1 failed · 1 running`. */
const summaryText = computed(() => {
  const s = summary.value;
  const parts: string[] = [];
  if (s.done) parts.push(`${s.done} updated`);
  if (s.failed) parts.push(`${s.failed} failed`);
  if (s.cancelled) parts.push(`${s.cancelled} cancelled`);
  if (s.pending) parts.push(`${s.pending} running or waiting`);
  return parts.join(' · ');
});

/** Plural helper. */
const tubes = (n: number) => `${n} ${n === 1 ? 'tube' : 'tubes'}`;

const BUTTON = 'inline-flex items-center justify-center h-7 px-2.5 rounded-md text-xs font-medium transition-colors border border-border hover:bg-accent disabled:opacity-50 disabled:pointer-events-none';
const PRIMARY = 'inline-flex items-center justify-center h-7 px-2.5 rounded-md text-xs font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none';
</script>

<template>
  <div class="flex flex-col gap-3 text-xs" @dragover.prevent @drop.prevent="takeFile($event.dataTransfer?.files)">
    <p v-if="!connected" class="rounded-md border border-border bg-muted/40 px-2 py-1.5 text-muted-foreground" data-offline>
      The Art-Net bridge is not connected. Updates continue in the bridge and are shown again once it reconnects.
    </p>

    <!-- Image -->
    <section class="flex flex-col gap-1.5">
      <div class="flex items-center gap-2">
        <button type="button" :class="BUTTON" :disabled="!connected" data-choose-file @click="fileInput?.click()">
          Choose .hex file…
        </button>
        <span class="min-w-0 truncate text-muted-foreground">{{ fileName ?? 'No file chosen (or drop one here)' }}</span>
        <input ref="fileInput" type="file" accept=".hex,.ihex" class="hidden" data-file-input @change="onFileInput">
      </div>
      <p v-if="loadingImage" class="text-muted-foreground">Reading the image…</p>
      <p v-else-if="imageError" class="text-destructive" data-image-error>{{ imageError }}</p>
      <p v-else-if="image" class="rounded-md border border-border px-2 py-1.5" data-image>
        <span class="font-medium">{{ describeImageModel(image) }}</span>
        · firmware <span class="font-medium tabular-nums">{{ image.version }}</span>
        <span class="text-muted-foreground"> · {{ image.length }} bytes</span>
      </p>
    </section>

    <!-- Tubes -->
    <section class="flex flex-col gap-1.5">
      <div class="flex items-center gap-2">
        <label v-if="image && selectable.length" class="flex items-center gap-1.5">
          <input
            type="checkbox"
            class="accent-primary"
            :checked="allSelected"
            :disabled="!!confirming"
            data-select-all
            @change="fw.selectAll(($event.target as HTMLInputElement).checked)"
          >
          <span class="font-medium text-muted-foreground">{{ uids?.length === 1 ? 'Tube' : 'Tubes' }}</span>
        </label>
        <span v-else class="font-medium text-muted-foreground">{{ uids?.length === 1 ? 'Tube' : 'Tubes' }}</span>
        <span v-if="readingTubes" class="text-[10px] text-muted-foreground/70">Reading…</span>
        <button
          type="button"
          :class="['ml-auto', BUTTON]"
          :disabled="!connected || readingTubes"
          title="Read the installed firmware of the tubes again"
          @click="fw.readTubes({ force: true })"
        >
          Refresh
        </button>
      </div>
      <ul v-if="candidates.length" class="max-h-[45vh] divide-y divide-border overflow-y-auto rounded-md border border-border">
        <FirmwareUpdateRow
          v-for="c in candidates"
          :key="c.uid"
          :candidate="c"
          :disabled="!!confirming"
          @select="fw.setSelected(c.uid, $event)"
          @cancel="fw.cancel(c.uid)"
        />
      </ul>
      <p v-else class="text-muted-foreground" data-empty>
        No RDM devices found on the ports of this node.
      </p>
    </section>

    <!-- Downgrade confirmation -->
    <div v-if="confirming" class="flex flex-col gap-2 rounded-md border border-destructive/50 px-2 py-2" role="alertdialog" data-confirm-downgrade>
      <p class="font-medium text-destructive">
        Downgrade {{ tubes(confirming.length) }}?
      </p>
      <p class="text-muted-foreground">
        The image is older than the installed firmware of:
        <span v-for="(c, i) in confirming" :key="c.uid" class="font-mono">{{ i ? ', ' : ' ' }}{{ c.uid }} ({{ c.currentVersion }} → {{ c.targetVersion }})</span>
      </p>
      <div class="flex justify-end gap-2">
        <button type="button" :class="BUTTON" @click="confirming = null">Back</button>
        <button type="button" :class="PRIMARY" data-confirm @click="startUpdate(true)">Downgrade and update</button>
      </div>
    </div>

    <!-- Footer -->
    <div class="flex items-center gap-2">
      <span class="min-w-0 flex-1 text-muted-foreground" data-summary>
        {{ summaryText }}<template v-if="running"> — updates continue when this dialog is closed</template>
      </span>
      <button v-if="running" type="button" :class="BUTTON" data-cancel-all @click="fw.cancel()">
        Cancel all
      </button>
      <button
        type="button"
        :class="PRIMARY"
        :disabled="!selected.length || !!confirming || !connected"
        data-start
        @click="startUpdate()"
      >
        Update {{ tubes(selected.length) }}
      </button>
    </div>
  </div>
</template>

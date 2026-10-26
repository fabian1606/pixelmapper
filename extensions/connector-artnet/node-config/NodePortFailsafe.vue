<script setup lang="ts">
/**
 * Failsafe of one node port (plan D8, M7.3; bridge contract rev 2): what
 * the port outputs when Art-Net stops — hold, zero, full or the recorded
 * scene — and “Record scene…” for that port. The mode is per port
 * (`PortState.failsafe`, per BindIndex), written with the port's
 * `artAddress` entry; the value shown is what the node reports afterwards
 * (D5). `null` = the bridge does not know it (pmnet-bridge 0.1 for ports
 * 2–4): shown as “unknown”, still writable.
 */
import { computed, ref } from 'vue';
import { useReplaceable } from '@pixelmapper/extension-api';
import type { ArtNetBackend } from '../bridge/backend';
import type { FailsafeMode, NodeState, PortState } from '../bridge/protocol-model';
import { portLabel } from '../bridge/protocol-model';
import { FAILSAFE_OPTIONS, failsafeHint, portsSharingFailsafe, recordSceneConfirm } from './port-rules';
import { useCommandRunner } from './use-node-context';
import ConfirmBox from './ConfirmBox.vue';

const props = defineProps<{
  node: NodeState;
  port: PortState;
  /** `Port 2`. */
  label: string;
  backend: ArtNetBackend;
  /** Bridge connected and node present. */
  online: boolean;
}>();

const Select = useReplaceable('pm.select');
const runner = useCommandRunner();
const { busy, error } = runner;

/** “Record scene” waits for confirmation. */
const confirmRecord = ref(false);
/** The node acknowledged a recorded scene. */
const recorded = ref(false);

const mode = computed(() => props.port.failsafe);
const hint = computed(() => failsafeHint(mode.value));
const locked = computed(() => !props.online || busy.value !== null);
/** Ports of the same BindIndex that the AcFail* commands affect as well (multi-port nodes). */
const confirmText = computed(() => {
  const all = props.node.ports.map(p => p.port);
  return recordSceneConfirm(props.label, portsSharingFailsafe(props.node, props.port.port).map(p => portLabel(p.port, all)));
});

/** Sends this port's failsafe change. */
function writeFailsafe(key: string, change: { failsafe: FailsafeMode } | { recordFailsafeScene: true }) {
  return runner.run(key, () => props.backend.request('artAddress', { nodeId: props.node.nodeId, ports: [{ port: { ...props.port.port }, ...change }] }));
}

/** Sets the failsafe mode of the port. */
function setMode(value: string) {
  recorded.value = false;
  void writeFailsafe('failsafe', { failsafe: value as FailsafeMode });
}

/** Records the port's current output as its failsafe scene (after confirmation). */
async function recordScene() {
  recorded.value = await writeFailsafe('record', { recordFailsafeScene: true });
  confirmRecord.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-1" data-failsafe>
    <div class="flex min-h-7 items-center gap-2">
      <span class="w-20 shrink-0 text-muted-foreground" :title="hint">Failsafe</span>
      <span v-if="mode === null" class="text-[10px] text-muted-foreground/70" :title="hint" data-failsafe-unknown>unknown</span>
      <span v-if="busy === 'failsafe'" class="text-[10px] text-muted-foreground/70">Writing…</span>
      <component
        :is="Select"
        v-if="node.status.failsafeProgrammable"
        :model-value="mode ?? ''"
        :options="FAILSAFE_OPTIONS"
        variant="segmented"
        size="sm"
        :disabled="locked"
        class="ml-auto w-48"
        @update:model-value="setMode"
      />
      <span v-else class="ml-auto text-muted-foreground">{{ FAILSAFE_OPTIONS.find(o => o.value === mode)?.label ?? 'Unknown' }}</span>
    </div>
    <div v-if="node.status.failsafeProgrammable" class="flex items-center gap-2">
      <span class="text-[10px] text-muted-foreground">{{ hint }}</span>
      <span v-if="recorded" class="text-[10px] text-primary">Scene recorded</span>
      <button
        v-if="!confirmRecord"
        type="button"
        class="ml-auto shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] transition-colors hover:bg-accent disabled:opacity-50"
        :disabled="locked"
        data-record-scene
        @click="confirmRecord = true"
      >
        Record scene…
      </button>
    </div>
    <ConfirmBox v-if="confirmRecord" :message="confirmText" confirm-label="Record scene" :busy="busy === 'record'" @confirm="recordScene" @cancel="confirmRecord = false" />
    <p v-if="error" class="text-[10px] text-destructive">{{ error }}</p>
  </div>
</template>

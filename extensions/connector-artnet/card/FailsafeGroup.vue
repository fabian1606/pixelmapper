<script setup lang="ts">
/**
 * Node-wide failsafe of the Art-Net card (WP13): by default one mode for
 * every port (Hold / Zero / Full / Scene; in Scene mode “Record scene…”
 * stores what all ports output now). “Custom per port” hands the setting
 * to the port blocks (`PortFailsafe`).
 *
 * Writes are the per-port `artAddress` failsafe entries (one per BindIndex,
 * `failsafeTargets`); what is shown is what the node reports afterwards
 * (D5). Whether the card is in custom mode is derived from the node by the
 * parent (ports differ → custom) unless the user chose; turning custom off
 * while the ports differ writes nothing until a mode is picked (“Mixed”).
 */
import { computed, ref } from 'vue';
import { useReplaceable } from '@pixelmapper/extension-api';
import type { ArtNetBackend } from '../bridge/backend';
import type { FailsafeMode, NodeState } from '../bridge/protocol-model';
import { FAILSAFE_OPTIONS, failsafeHint, failsafeTargets, recordAllScenesConfirm, sharedFailsafe } from '../node-config/port-rules';
import { useCommandRunner } from '../node-config/use-node-context';
import ConfirmBox from '../node-config/ConfirmBox.vue';
import InfoTip from './InfoTip.vue';

const props = defineProps<{
  node: NodeState;
  backend: ArtNetBackend;
  /** Bridge connected and node present. */
  online: boolean;
  /** “Custom per port” is on. */
  custom: boolean;
}>();
const emit = defineEmits<{ 'update:custom': [custom: boolean] }>();

const Select = useReplaceable('pm.select');
const Toggle = useReplaceable('pm.toggle');
const runner = useCommandRunner();
const { busy, error } = runner;

/** “Record scene” waits for confirmation. */
const confirmRecord = ref(false);
/** The node acknowledged the recorded scenes. */
const recorded = ref(false);

const shared = computed(() => sharedFailsafe(props.node));
const mode = computed<FailsafeMode | null>(() => (shared.value === 'mixed' ? null : shared.value));
const targets = computed(() => failsafeTargets(props.node));
const locked = computed(() => !props.online || busy.value !== null);
const programmable = computed(() => props.node.status.failsafeProgrammable);

/** Sends one failsafe change to every BindIndex of the node. */
function writeAll(key: string, change: { failsafe: FailsafeMode } | { recordFailsafeScene: true }) {
  return runner.run(key, () => props.backend.request('artAddress', { nodeId: props.node.nodeId, ports: targets.value.map(port => ({ port: { ...port }, ...change })) }));
}

/** Sets the mode of all ports. */
function setMode(value: string) {
  if (!value) return;
  recorded.value = false;
  confirmRecord.value = false;
  void writeAll('failsafe', { failsafe: value as FailsafeMode });
}

/** Records the current output of all ports as their scenes (after confirmation). */
async function recordScene() {
  recorded.value = await writeAll('record', { recordFailsafeScene: true });
  confirmRecord.value = false;
}
</script>

<template>
  <section class="flex flex-col gap-1 text-xs" data-failsafe-group>
    <div class="flex min-h-7 items-center gap-2">
      <span class="flex shrink-0 items-center gap-1 font-medium">Failsafe <InfoTip topic="failsafe" /></span>
      <span v-if="busy === 'failsafe'" class="text-[10px] text-muted-foreground/70">Writing…</span>
      <template v-if="!custom">
        <span v-if="shared === 'mixed'" class="rounded bg-muted px-1 text-[10px] text-muted-foreground" data-failsafe-mixed>Mixed</span>
        <component
          :is="Select"
          v-if="programmable"
          :model-value="mode ?? ''"
          :options="FAILSAFE_OPTIONS"
          variant="segmented"
          size="sm"
          :disabled="locked"
          class="ml-auto w-48"
          data-failsafe-all
          @update:model-value="setMode"
        />
        <span v-else class="ml-auto text-muted-foreground">{{ FAILSAFE_OPTIONS.find(o => o.value === mode)?.label ?? 'Unknown' }}</span>
      </template>
      <span v-else class="ml-auto text-[11px] text-muted-foreground" data-failsafe-custom-note>Set in each port's settings</span>
    </div>
    <div v-if="!custom" class="flex items-center gap-2">
      <span class="text-[10px] text-muted-foreground">
        {{ shared === 'mixed' ? 'Ports currently differ. Choosing a mode sets all ports.' : failsafeHint(mode) }}
      </span>
      <span v-if="recorded" class="text-[10px] text-primary">Scene recorded</span>
      <span v-if="programmable && mode === 'scene' && !confirmRecord" class="ml-auto flex shrink-0 items-center gap-1">
        <button
          type="button"
          class="rounded border border-border px-1.5 py-0.5 text-[11px] transition-colors hover:bg-accent disabled:opacity-50"
          :disabled="locked"
          data-record-scene
          @click="confirmRecord = true"
        >
          Record scene…
        </button>
        <InfoTip topic="recordScene" />
      </span>
    </div>
    <ConfirmBox v-if="confirmRecord" :message="recordAllScenesConfirm(targets.length)" confirm-label="Record scene" :busy="busy === 'record'" @confirm="recordScene" @cancel="confirmRecord = false" />
    <div v-if="programmable && targets.length > 1" class="flex min-h-6 items-center gap-1 text-[11px] text-muted-foreground">
      Custom per port <InfoTip topic="failsafeCustom" />
      <component :is="Toggle" :model-value="custom" size="sm" class="ml-auto" data-failsafe-custom @update:model-value="(v: boolean) => emit('update:custom', v)" />
    </div>
    <p v-if="error" class="text-[10px] text-destructive">{{ error }}</p>
  </section>
</template>

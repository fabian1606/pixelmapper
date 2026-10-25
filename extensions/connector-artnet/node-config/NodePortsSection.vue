<script setup lang="ts">
/**
 * “Ports” section of the node configuration (plan D8, M7.3): the node-wide
 * failsafe mode with “Record scene”, then one `NodePortRow` per port.
 * Reads the live node from the directory; writes go through ArtAddress,
 * ArtInput and the node's RDM PIDs, and the state shown is what the node
 * reports afterwards (D5).
 */
import { computed, ref } from 'vue';
import { useReplaceable } from '@pixelmapper/extension-api';
import { portLabel } from '../bridge/protocol-model';
import { FAILSAFE_OPTIONS, RECORD_SCENE_CONFIRM } from './port-rules';
import { useCommandRunner, useNodeContext, useSharedNodeDescription, type NodeConfigProps } from './use-node-context';
import { usePortEnabled } from './use-port-enabled';
import ConfirmBox from './ConfirmBox.vue';
import NodePortRow from './NodePortRow.vue';

const props = withDefaults(defineProps<NodeConfigProps>(), { backend: undefined, directory: undefined });

const ctx = useNodeContext(props);
const { node, online, connected, backend } = ctx;
const desc = useSharedNodeDescription(ctx);
const enabled = usePortEnabled(backend, desc);
const runner = useCommandRunner();
const { busy, error } = runner;
const Select = useReplaceable('pm.select');

/** “Record scene” waits for confirmation. */
const confirmRecord = ref(false);
/** The node acknowledged a recorded scene. */
const recorded = ref(false);

/** One entry per port with its label. */
const ports = computed(() => {
  const all = node.value?.ports.map(p => p.port) ?? [];
  return (node.value?.ports ?? []).map(p => ({ state: p, label: portLabel(p.port, all), key: `${p.port.bind}.${p.port.index}` }));
});

/** RDM responder of a Pixelmapper Node (per-port PIDs), else null. */
const rdm = computed(() => {
  const address = desc.address.value;
  const description = desc.description.value;
  return desc.pixelmapperNode.value && address && description ? { address, description } : null;
});

const failsafeHint = computed(() => FAILSAFE_OPTIONS.find(o => o.value === node.value?.status.failsafe)?.hint ?? '');

/** Sets the failsafe mode of the node. */
function setFailsafe(value: string) {
  recorded.value = false;
  void runner.run('failsafe', () => backend.request('artAddress', { nodeId: props.nodeId, failsafe: value as 'hold' | 'zero' | 'full' | 'scene' }));
}

/** Records the current output as failsafe scene (after confirmation). */
async function recordScene() {
  recorded.value = await runner.run('record', () => backend.request('artAddress', { nodeId: props.nodeId, recordFailsafeScene: true }));
  confirmRecord.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-1.5 text-xs">
    <p v-if="!node" class="text-[11px] text-muted-foreground">
      {{ connected ? 'The node is offline. Its ports can be changed when it answers again.' : 'The Art-Net bridge is not connected.' }}
    </p>
    <template v-else>
      <p v-if="node.status.portAddressAuthority === 'panel'" class="text-[10px] text-muted-foreground">
        The node's addresses are set at its front panel; it may ignore changes from the network.
      </p>
      <div class="flex min-h-7 items-center gap-2" data-failsafe>
        <span class="w-20 shrink-0 text-muted-foreground" :title="failsafeHint">Failsafe</span>
        <span v-if="busy === 'failsafe'" class="text-[10px] text-muted-foreground/70">Writing…</span>
        <component
          :is="Select"
          v-if="node.status.failsafeProgrammable"
          :model-value="node.status.failsafe"
          :options="FAILSAFE_OPTIONS"
          variant="segmented"
          size="sm"
          :disabled="!online || busy !== null"
          class="ml-auto w-48"
          @update:model-value="setFailsafe"
        />
        <span v-else class="ml-auto text-muted-foreground">{{ FAILSAFE_OPTIONS.find(o => o.value === node!.status.failsafe)?.label }}</span>
      </div>
      <div v-if="node.status.failsafeProgrammable" class="flex items-center gap-2">
        <span class="text-[10px] text-muted-foreground">{{ failsafeHint }}</span>
        <span v-if="recorded" class="text-[10px] text-primary">Scene recorded</span>
        <button
          v-if="!confirmRecord"
          type="button"
          class="ml-auto rounded border border-border px-1.5 py-0.5 text-[11px] transition-colors hover:bg-accent disabled:opacity-50"
          :disabled="!online || busy !== null"
          data-record-scene
          @click="confirmRecord = true"
        >
          Record scene…
        </button>
      </div>
      <ConfirmBox v-if="confirmRecord" :message="RECORD_SCENE_CONFIRM" confirm-label="Record scene" :busy="busy === 'record'" @confirm="recordScene" @cancel="confirmRecord = false" />
      <p v-if="error" class="text-[10px] text-destructive">{{ error }}</p>
      <NodePortRow
        v-for="p in ports"
        :key="p.key"
        :node="node"
        :port="p.state"
        :label="p.label"
        :backend="backend"
        :enable="enabled.stateOf(p.state.port)"
        :set-enabled="(v: boolean) => enabled.write(p.state.port, v)"
        :online="online"
        :rdm="rdm"
      />
    </template>
  </div>
</template>

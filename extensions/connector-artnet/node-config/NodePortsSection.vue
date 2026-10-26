<script setup lang="ts">
/**
 * “Ports” section of the node configuration (plan D8, M7.3): one
 * `NodePortRow` per port (mode, Port-Address, merge, RDM, output style and
 * the port's failsafe mode with “Record scene”; the failsafe is per port
 * since bridge contract rev 2). Reads the live node from the directory;
 * writes go through ArtAddress, ArtInput and the node's RDM PIDs, and the
 * state shown is what the node reports afterwards (D5). The node's RDM-only
 * port settings are re-read when the node changes (`useNodeChangeSignal`)
 * and every 45 s.
 */
import { computed } from 'vue';
import { portLabel } from '../bridge/protocol-model';
import { RDM_SETTINGS_REREAD_MS } from '../rdm/parameter-form/use-rdm-parameter-form';
import { useNodeChangeSignal } from './use-node-change-signal';
import { useNodeContext, useSharedNodeDescription, type NodeConfigProps } from './use-node-context';
import { usePortEnabled } from './use-port-enabled';
import NodePortRow from './NodePortRow.vue';

const props = withDefaults(defineProps<NodeConfigProps>(), { backend: undefined, directory: undefined });

const ctx = useNodeContext(props);
const { node, online, connected, backend } = ctx;
const desc = useSharedNodeDescription(ctx);
/** Goes up when the node changed: its RDM-only settings are read again. */
const nodeChanges = useNodeChangeSignal(() => node.value);
const enabled = usePortEnabled(backend, desc, RDM_SETTINGS_REREAD_MS, nodeChanges);

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
        :reread-on="nodeChanges"
      />
    </template>
  </div>
</template>

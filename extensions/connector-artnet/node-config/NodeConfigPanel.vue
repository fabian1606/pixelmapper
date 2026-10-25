<script setup lang="ts">
/**
 * Node configuration of an Art-Net node's connector card (plan D8, M7.3):
 * collapsible sections Ports, Network, Device and Advanced, stacked. The
 * node's RDM description is read once for all sections. Closed sections
 * are not mounted, so they send no requests.
 *
 * Usage: `<NodeConfigPanel :node-id="connector.nodeId.value" @follow="…" />`
 */
import { computed, reactive } from 'vue';
import { provideNodeDescription, useNodeContext, type NodeConfigProps, type NodeConfigSectionId } from './use-node-context';
import ConfigSection from './ConfigSection.vue';
import NodeAdvancedSection from './NodeAdvancedSection.vue';
import NodeDeviceSection from './NodeDeviceSection.vue';
import NodeNetworkSection from './NodeNetworkSection.vue';
import NodePortsSection from './NodePortsSection.vue';

const props = withDefaults(defineProps<NodeConfigProps & {
  /** Sections open at first (default: Ports only). */
  initialOpen?: NodeConfigSectionId[];
}>(), { backend: undefined, directory: undefined, initialOpen: () => ['ports'] });

const emit = defineEmits<{
  /** The node answers at a new address after a network change (see NodeNetworkSection). */
  follow: [target: { nodeId: string; ip: string }];
}>();

const ctx = useNodeContext(props);
const { node, connected, backend, directory } = ctx;
provideNodeDescription(ctx);

/** Open state per section. */
const open = reactive<Record<NodeConfigSectionId, boolean>>({
  ports: props.initialOpen.includes('ports'),
  network: props.initialOpen.includes('network'),
  device: props.initialOpen.includes('device'),
  advanced: props.initialOpen.includes('advanced'),
});

/** Header hints. */
const hints = computed(() => ({
  ports: node.value ? `${node.value.ports.length} ${node.value.ports.length === 1 ? 'port' : 'ports'}` : undefined,
  network: node.value?.ip,
  device: node.value?.shortName || undefined,
  advanced: node.value?.uid ? 'RDM' : undefined,
}));
</script>

<template>
  <div class="flex flex-col" data-node-config>
    <p v-if="!connected" class="text-[11px] text-muted-foreground">Connect the Art-Net bridge to configure the node.</p>
    <p v-else-if="!node" class="text-[11px] text-muted-foreground">The node does not answer; its settings can be changed when it is back.</p>
    <ConfigSection v-model:open="open.ports" title="Ports" :hint="hints.ports">
      <NodePortsSection :node-id="nodeId" :backend="backend" :directory="directory" />
    </ConfigSection>
    <ConfigSection v-model:open="open.network" title="Network" :hint="hints.network">
      <NodeNetworkSection :node-id="nodeId" :backend="backend" :directory="directory" @follow="emit('follow', $event)" />
    </ConfigSection>
    <ConfigSection v-model:open="open.device" title="Device" :hint="hints.device">
      <NodeDeviceSection :node-id="nodeId" :backend="backend" :directory="directory" />
    </ConfigSection>
    <ConfigSection v-model:open="open.advanced" title="Advanced" :hint="hints.advanced">
      <NodeAdvancedSection :node-id="nodeId" :backend="backend" :directory="directory" />
    </ConfigSection>
  </div>
</template>

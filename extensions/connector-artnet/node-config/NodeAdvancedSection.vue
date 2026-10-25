<script setup lang="ts">
/**
 * “Advanced” section of the node configuration (plan D8, M7.3): every
 * further parameter of the node's own RDM responder, generated from
 * SUPPORTED_PARAMETERS + PARAMETER_DESCRIPTION by the generic form (M7.1).
 * Left out: what other sections show — the Pixelmapper Node's per-port
 * PIDs (Ports) and DEVICE_LABEL / IDENTIFY_DEVICE (the form never shows
 * those).
 */
import { computed } from 'vue';
import RdmParameterForm from '../rdm/parameter-form/RdmParameterForm.vue';
import { NODE_PORT_PIDS } from './port-rules';
import { useNodeContext, useSharedNodeDescription, type NodeConfigProps } from './use-node-context';

const props = withDefaults(defineProps<NodeConfigProps>(), { backend: undefined, directory: undefined });

const ctx = useNodeContext(props);
const { node, connected, backend } = ctx;
const desc = useSharedNodeDescription(ctx);
const { description, address, loading, error } = desc;

/** PIDs shown in the Ports section (only for the Pixelmapper Node: pids.toml numbers). */
const exclude = computed(() => (desc.pixelmapperNode.value ? [...NODE_PORT_PIDS] : []));
</script>

<template>
  <div class="flex flex-col gap-1.5 text-xs">
    <p v-if="!connected" class="text-[11px] text-muted-foreground">The Art-Net bridge is not connected.</p>
    <p v-else-if="node && !node.uid" class="text-[11px] text-muted-foreground">This node reports no RDM responder (no UID), so it has no further parameters.</p>
    <p v-else-if="!description && loading" class="text-[11px] text-muted-foreground">Reading the node's parameters…</p>
    <p v-else-if="!description && !node" class="text-[11px] text-muted-foreground">The node is offline.</p>
    <div v-if="error" class="flex items-center gap-2 text-[10px] text-destructive">
      <span>Reading the node's parameters failed: {{ error }}</span>
      <button type="button" class="ml-auto rounded border border-border px-1.5 py-0.5 text-[11px] text-foreground hover:bg-accent disabled:opacity-50" :disabled="loading || !node" @click="desc.refresh()">Retry</button>
    </div>
    <RdmParameterForm v-if="description && address" :address="address" :description="description" :backend="backend" :exclude="exclude" title="Node parameters" />
  </div>
</template>

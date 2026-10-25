<script setup lang="ts">
/**
 * “Device” section of the node configuration (plan D8, M7.3): short and
 * long name (ArtAddress, ≤ 17 / ≤ 63 bytes), identify (ArtAddress LED
 * Locate; switched off again when the section closes), firmware and
 * identity read-only, and the RDM DEVICE_LABEL where it is a separate
 * setting. Names show the node's state: an edit is sent on commit and the
 * new name appears with the node's `node` event (D5).
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import { useReplaceable } from '@pixelmapper/extension-api';
import { RDM_PID } from '../bridge/rdm-constants';
import { LONG_NAME_MAX_BYTES, SHORT_NAME_MAX_BYTES, formatVersInfo, nameError } from './device-rules';
import { useCommandRunner, useNodeContext, useSharedNodeDescription, type NodeConfigProps } from './use-node-context';
import NodeDeviceLabel from './NodeDeviceLabel.vue';

const props = withDefaults(defineProps<NodeConfigProps>(), { backend: undefined, directory: undefined });

const ctx = useNodeContext(props);
const { node, online, connected, backend } = ctx;
const desc = useSharedNodeDescription(ctx);
const runner = useCommandRunner();
const { busy, error } = runner;
const Toggle = useReplaceable('pm.toggle');

/** The two ArtAddress names. */
const NAMES = [
  { key: 'shortName', label: 'Short name', max: SHORT_NAME_MAX_BYTES },
  { key: 'longName', label: 'Long name', max: LONG_NAME_MAX_BYTES },
] as const;
type NameKey = (typeof NAMES)[number]['key'];

/** Names being edited; missing = showing the node's name. */
const drafts = ref<Partial<Record<NameKey, string>>>({});
/** Validation message per name. */
const nameErrors = computed(() => Object.fromEntries(NAMES.map(n => [n.key, drafts.value[n.key] === undefined ? null : nameError(drafts.value[n.key]!, n.max)])) as Record<NameKey, string | null>);

/** This section switched identify on (and switches it off when it closes). */
let identifyStarted = false;
const locating = computed(() => node.value?.status.indicator === 'locate');

/** Firmware: ArtPollReply VersInfo plus the RDM software version label. */
const firmware = computed(() => (node.value ? formatVersInfo(node.value.firmware) : null));
const description = computed(() => desc.description.value);
/** DEVICE_LABEL is its own setting (on the Pixelmapper Node it is the short name). */
const labelAddress = computed(() => (description.value?.supportedParameters.includes(RDM_PID.DEVICE_LABEL) && !desc.pixelmapperNode.value ? desc.address.value : null));

/** Sends an edited name (on blur/Enter) unless invalid or unchanged. */
async function commitName(key: NameKey) {
  const text = drafts.value[key];
  if (text === undefined || nameErrors.value[key] || !node.value) return;
  if (text === node.value[key]) {
    drafts.value = { ...drafts.value, [key]: undefined };
    return;
  }
  const args = key === 'shortName' ? { nodeId: props.nodeId, shortName: text } : { nodeId: props.nodeId, longName: text };
  const ok = await runner.run(key, () => backend.request('artAddress', args));
  if (ok) drafts.value = { ...drafts.value, [key]: undefined };
}

/** Switches identify (LED Locate) on or off. */
async function setIdentify(on: boolean) {
  const ok = await runner.run('identify', () => backend.request('artAddress', { nodeId: props.nodeId, indicator: on ? 'locate' : 'normal' }));
  if (ok) identifyStarted = on;
}

/** Turns the display on again after LED Mute. */
function unmute() {
  void runner.run('identify', () => backend.request('artAddress', { nodeId: props.nodeId, indicator: 'normal' }));
}

// Identify ends when the section closes (fire-and-forget; the panel is gone).
onBeforeUnmount(() => {
  if (!identifyStarted || !connected.value) return;
  backend.request('artAddress', { nodeId: props.nodeId, indicator: 'normal' }).catch((err) => {
    console.warn('[artnet] switching identify off failed:', err);
  });
});

/** Classes of the name inputs. */
const INPUT = 'w-full rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50';
</script>

<template>
  <div class="flex flex-col gap-1.5 text-xs">
    <p v-if="!node" class="text-[11px] text-muted-foreground">{{ connected ? 'The node is offline.' : 'The Art-Net bridge is not connected.' }}</p>
    <template v-else>
      <div v-for="n in NAMES" :key="n.key" class="flex flex-col gap-0.5" :data-field="n.key">
        <div class="flex min-h-7 items-center gap-2">
          <span class="w-20 shrink-0 text-muted-foreground">{{ n.label }}</span>
          <input
            type="text"
            :class="INPUT"
            :value="drafts[n.key] ?? node[n.key]"
            :maxlength="n.max"
            :disabled="!online || busy === n.key"
            :aria-label="n.label"
            @input="drafts = { ...drafts, [n.key]: ($event.target as HTMLInputElement).value }"
            @change="commitName(n.key)"
          >
        </div>
        <p v-if="nameErrors[n.key]" class="text-[10px] text-destructive">{{ nameErrors[n.key] }}</p>
      </div>
      <div class="flex min-h-7 items-center gap-2" data-field="identify">
        <span class="w-20 shrink-0 text-muted-foreground" title="Flashes the node's display (ArtAddress LED Locate)">Identify</span>
        <span v-if="node.status.indicator === 'mute'" class="text-[10px] text-muted-foreground">Display off</span>
        <button v-if="node.status.indicator === 'mute'" type="button" class="rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-accent disabled:opacity-50" :disabled="!online || busy !== null" @click="unmute">Turn display on</button>
        <component :is="Toggle" :model-value="locating" :disabled="!online || busy === 'identify'" size="sm" class="ml-auto" @update:model-value="setIdentify" />
      </div>
      <p v-if="error" class="text-[10px] text-destructive">{{ error }}</p>
      <NodeDeviceLabel v-if="labelAddress" :address="labelAddress" :backend="backend" :disabled="!online" />
      <dl class="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-0.5 text-[11px]" data-field="info">
        <dt class="text-muted-foreground">Firmware</dt>
        <dd class="font-mono">
          {{ firmware }}<template v-if="description?.softwareVersionLabel"> · {{ description.softwareVersionLabel }}</template>
        </dd>
        <template v-if="description?.bootSoftwareVersionLabel">
          <dt class="text-muted-foreground">Bootloader</dt>
          <dd class="font-mono">{{ description.bootSoftwareVersionLabel }}</dd>
        </template>
        <template v-if="description?.deviceModelDescription">
          <dt class="text-muted-foreground">Model</dt>
          <dd>{{ description.deviceModelDescription }}<template v-if="description.manufacturerLabel"> · {{ description.manufacturerLabel }}</template></dd>
        </template>
        <dt class="text-muted-foreground">Identity</dt>
        <dd class="font-mono">{{ node.uid ? `UID ${node.uid}` : node.mac ? `MAC ${node.mac}` : node.nodeId }}</dd>
      </dl>
    </template>
  </div>
</template>

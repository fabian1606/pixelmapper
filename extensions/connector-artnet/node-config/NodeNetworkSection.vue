<script setup lang="ts">
/**
 * “Network” section of the node configuration (plan D8, M7.3): DHCP or
 * static IP, subnet mask (/8–/30, shown dotted) and gateway via ArtIpProg.
 *
 * The current values come from the node (an ArtIpProg without changes is
 * answered with its ArtIpProgReply). Edits are staged and validated
 * locally — including the bridge's DHCP rule (contract rev 2: DHCP on goes
 * alone, DHCP off needs a static IP) — “Apply…” asks first (new IP,
 * connections drop), sends only the diff, and then follows the node by its
 * identity to its new address (`follow` event). “Reset network to
 * defaults…” asks as well.
 */
import { computed, reactive, ref, shallowRef, watch } from 'vue';
import { useReplaceable } from '@pixelmapper/extension-api';
import { ipProgArgsProblem } from '../bridge/command-limits';
import { PREFIX_OPTIONS } from './ipv4';
import {
  CONNECTION_DROP_WARNING,
  RESET_CONFIRM_MESSAGE,
  applyConfirmMessage,
  changesAddress,
  draftFromSettings,
  networkChanges,
  validateNetworkDraft,
  type NetworkDraft,
  type NetworkSettings,
} from './network-draft';
import { describeNodeError } from './device-rules';
import { useCommandRunner, useNodeContext, type NodeConfigProps } from './use-node-context';
import { useNodeFollow } from './use-node-follow';
import ConfirmBox from './ConfirmBox.vue';

const props = withDefaults(defineProps<NodeConfigProps & {
  /** Time until a moved node counts as not answering (ms). */
  followTimeoutMs?: number;
}>(), { backend: undefined, directory: undefined, followTimeoutMs: undefined });

const emit = defineEmits<{
  /** The node answers at its new address (after Apply or Reset). */
  follow: [target: { nodeId: string; ip: string }];
}>();

const ctx = useNodeContext(props);
const { node, online, connected, backend, directory } = ctx;
const runner = useCommandRunner();
const { busy, error } = runner;
const Select = useReplaceable('pm.select');

/** What the node last reported (ArtIpProgReply). */
const current = shallowRef<NetworkSettings | null>(null);
/** Staged values. */
const draft = reactive<NetworkDraft>({ dhcp: false, ip: '', prefix: null, gateway: '' });
const reading = ref(false);
const readError = ref<string | null>(null);
/** Confirmation shown: apply the draft or reset to defaults. */
const confirming = ref<'apply' | 'reset' | null>(null);

const follow = useNodeFollow(backend, directory, () => props.nodeId, (found) => {
  emit('follow', { nodeId: found.nodeId, ip: found.ip });
}, props.followTimeoutMs);

const change = computed(() => (current.value ? networkChanges(current.value, draft) : null));
const errors = computed(() => validateNetworkDraft(draft));
/** The diff breaks the bridge's DHCP rule (it would answer `badRequest`, field `dhcp`); null when fine. */
const argsProblem = computed(() => (change.value ? ipProgArgsProblem(change.value)?.message ?? null : null));
const valid = computed(() => Object.keys(errors.value).length === 0 && argsProblem.value === null);
const locked = computed(() => !online.value || busy.value !== null);
const dhcpOffered = computed(() => !!node.value?.status.dhcpCapable || !!current.value?.dhcp);
const modeOptions = computed(() => [...(dhcpOffered.value ? [{ value: 'dhcp', label: 'DHCP' }] : []), { value: 'static', label: 'Static' }]);
const maskOptions = computed(() => {
  const options = PREFIX_OPTIONS.map(o => ({ value: String(o.prefix), label: o.label }));
  if (draft.prefix === null && current.value) options.unshift({ value: '', label: `${current.value.mask} (current)` });
  return options;
});

/** Follow progress as text. */
const followText = computed(() => {
  const s = follow.state.value;
  if (s.kind === 'waiting') return s.ip ? `Waiting for the node at ${s.ip}…` : 'Waiting for the node to get its address…';
  if (s.kind === 'found') return `The node answers at ${s.ip}.`;
  if (s.kind === 'lost') return `The node has not answered${s.ip ? ` at ${s.ip}` : ''} yet. If this computer is not in the node's new network, Art-Net cannot reach it.`;
  return null;
});

/** Takes the node's report; the draft follows unless the user has staged changes. */
function setCurrent(next: NetworkSettings, resetDraft = false) {
  const untouched = !current.value || networkChanges(current.value, draft) === null;
  current.value = next;
  if (untouched || resetDraft) Object.assign(draft, draftFromSettings(next));
}

/** Reads the node's network settings (ArtIpProg without changes). */
async function read() {
  reading.value = true;
  try {
    const r = await backend.request('ipProg', { nodeId: props.nodeId });
    setCurrent({ dhcp: r.dhcp, ip: r.ip, mask: r.mask, gateway: r.gateway });
    readError.value = null;
  }
  catch (err) {
    readError.value = describeNodeError(err);
  }
  finally {
    reading.value = false;
  }
}

// Read when the node is (back) online and whenever its address or DHCP state changes
// (separate sources: other node events, e.g. data flags, must not trigger a read).
watch([online, () => node.value?.ip, () => node.value?.status.dhcpConfigured], () => {
  if (online.value && busy.value === null) void read();
}, { immediate: true });

/** Sends the staged diff (after confirmation), then follows the node. */
async function apply() {
  const before = current.value;
  const diff = change.value;
  const previousIp = node.value?.ip ?? before?.ip ?? '';
  if (!before || !diff) return;
  const problem = ipProgArgsProblem(diff);
  if (problem) {
    error.value = problem.message;
    confirming.value = null;
    return;
  }
  // `as`: assigned inside the callback, so TypeScript must not narrow it to null.
  let reply = null as NetworkSettings | null;
  await runner.run('apply', async () => {
    const r = await backend.request('ipProg', { nodeId: props.nodeId, ...diff });
    reply = { dhcp: r.dhcp, ip: r.ip, mask: r.mask, gateway: r.gateway };
  });
  confirming.value = null;
  if (!reply) return;
  setCurrent(reply, true);
  if (changesAddress(before, diff)) follow.start({ ip: reply.dhcp ? null : reply.ip, previousIp });
}

/** Resets the node's network settings (after confirmation), then follows it. */
async function reset() {
  const previousIp = node.value?.ip ?? current.value?.ip ?? '';
  let reply = null as NetworkSettings | null;
  await runner.run('reset', async () => {
    const r = await backend.request('ipProg', { nodeId: props.nodeId, resetToDefault: true });
    reply = { dhcp: r.dhcp, ip: r.ip, mask: r.mask, gateway: r.gateway };
  });
  confirming.value = null;
  if (!reply) return;
  setCurrent(reply, true);
  follow.start({ ip: reply.dhcp ? null : reply.ip, previousIp });
}

/** Value of a text input event. */
const text = (e: Event) => (e.target as HTMLInputElement).value;
/** Classes of text inputs and buttons. */
const INPUT = 'w-full rounded border border-border bg-background px-1.5 py-0.5 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50';
const BUTTON = 'px-1.5 py-0.5 rounded border border-border hover:bg-accent transition-colors text-[11px] disabled:opacity-50';
</script>

<template>
  <div class="flex flex-col gap-1.5 text-xs">
    <p v-if="!connected" class="text-[11px] text-muted-foreground">The Art-Net bridge is not connected.</p>
    <p v-else-if="!node && follow.state.value.kind === 'idle'" class="text-[11px] text-muted-foreground">The node is offline.</p>
    <p v-if="readError" class="text-[10px] text-destructive">Reading the network settings failed: {{ readError }}</p>
    <template v-if="current">
      <div class="flex min-h-7 items-center gap-2" data-field="mode">
        <span class="w-20 shrink-0 text-muted-foreground">Address</span>
        <component :is="Select" v-if="modeOptions.length > 1" :model-value="draft.dhcp ? 'dhcp' : 'static'" :options="modeOptions" variant="segmented" size="sm" :disabled="locked" class="ml-auto w-36" @update:model-value="(v: string) => (draft.dhcp = v === 'dhcp')" />
        <span v-else class="ml-auto text-muted-foreground">Static</span>
      </div>
      <div class="flex min-h-7 items-center gap-2" data-field="ip">
        <span class="w-20 shrink-0 text-muted-foreground">IP</span>
        <input type="text" :class="INPUT" :value="draft.dhcp ? current.ip : draft.ip" :disabled="locked || draft.dhcp" aria-label="IP address" @input="draft.ip = text($event)">
      </div>
      <p v-if="errors.ip" class="text-[10px] text-destructive">{{ errors.ip }}</p>
      <div class="flex min-h-7 items-center gap-2" data-field="mask">
        <span class="w-20 shrink-0 text-muted-foreground">Subnet mask</span>
        <span v-if="draft.dhcp" class="ml-auto font-mono text-muted-foreground">{{ current.mask }}</span>
        <component :is="Select" v-else :model-value="draft.prefix === null ? '' : String(draft.prefix)" :options="maskOptions" variant="dropdown" size="sm" :disabled="locked" class="ml-auto w-48" @update:model-value="(v: string) => (draft.prefix = v === '' ? null : Number(v))" />
      </div>
      <p v-if="errors.prefix" class="text-[10px] text-destructive">{{ errors.prefix }}</p>
      <div class="flex min-h-7 items-center gap-2" data-field="gateway">
        <span class="w-20 shrink-0 text-muted-foreground">Gateway</span>
        <input type="text" :class="INPUT" :value="draft.dhcp ? (current.gateway === '0.0.0.0' ? '' : current.gateway) : draft.gateway" placeholder="none" :disabled="locked || draft.dhcp" aria-label="Gateway" @input="draft.gateway = text($event)">
      </div>
      <p v-if="errors.gateway" class="text-[10px] text-destructive">{{ errors.gateway }}</p>
      <p v-if="argsProblem && !Object.keys(errors).length" class="text-[10px] text-destructive" data-args-problem>{{ argsProblem }}</p>
      <div class="flex items-center justify-end gap-1">
        <span v-if="reading" class="mr-auto text-[10px] text-muted-foreground/70">Reading…</span>
        <button v-if="change" type="button" :class="BUTTON" :disabled="busy !== null" @click="setCurrent(current!, true)">Discard</button>
        <button type="button" :class="BUTTON" :disabled="locked || !change || !valid || confirming !== null" data-apply @click="confirming = 'apply'">Apply…</button>
      </div>
      <ConfirmBox v-if="confirming === 'apply'" :message="applyConfirmMessage(draft)" :detail="CONNECTION_DROP_WARNING" confirm-label="Apply" :busy="busy === 'apply'" @confirm="apply" @cancel="confirming = null" />
    </template>
    <p v-if="followText" class="text-[10px]" :class="follow.state.value.kind === 'lost' ? 'text-destructive' : 'text-muted-foreground'" data-follow>{{ followText }}</p>
    <p v-if="error" class="text-[10px] text-destructive">{{ error }}</p>
    <div class="flex justify-end">
      <button v-if="confirming !== 'reset'" type="button" :class="[BUTTON, 'text-destructive']" :disabled="locked || confirming !== null" data-reset @click="confirming = 'reset'">Reset network to defaults…</button>
    </div>
    <ConfirmBox v-if="confirming === 'reset'" :message="RESET_CONFIRM_MESSAGE" :detail="CONNECTION_DROP_WARNING" confirm-label="Reset network" :busy="busy === 'reset'" @confirm="reset" @cancel="confirming = null" />
  </div>
</template>

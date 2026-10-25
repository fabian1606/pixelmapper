<script setup lang="ts">
/**
 * RDM devices on the ports of one node (plan M6.1, D9, D12), in the node's
 * connector card: one row per device from the TODs (address · label · model
 * · personality · firmware · state) with Identify, Add and Assign free
 * address, and for the node Add all (one undo step), Auto-address and
 * Rediscover (ArtTodControl flush). Devices reach the canvas only through
 * Add / Add all. Identify is switched off when the card closes.
 */
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import type { RdmUid } from '../bridge/protocol-model';
import type { ArtNetNodeConnector } from '../node/node-connector';
import { addDevices } from '../devices/add-devices';
import { assignFreeAddress, autoAddress } from '../devices/addressing';
import { getDeviceRuntime, type DeviceRuntime } from '../devices/device-runtime';
import { useDeviceList } from '../devices/use-device-list';
import DeviceRow from './DeviceRow.vue';

const props = defineProps<{
  connector: ArtNetNodeConnector;
  /** Runtime to use (tests); default the app's. */
  runtime?: DeviceRuntime | null;
}>();

const runtime = props.runtime ?? getDeviceRuntime();
const { rows } = runtime ? useDeviceList(runtime, () => props.connector.nodeId.value) : { rows: computed(() => []) };

/** UIDs with an action in flight, and per-device messages of the last action. */
const busy = reactive(new Set<RdmUid>());
const messages = reactive(new Map<RdmUid, { text: string; error: boolean }>());
const nodeBusy = ref(false);
const summary = ref<{ text: string; error: boolean } | null>(null);

/** Devices that Add all would add. */
const addable = computed(() => rows.value.filter(r => r.canAdd));
/** True when Auto-address has something to do. */
const hasLinked = computed(() => rows.value.some(r => r.fixtureId !== null && r.entry.present));

/** Runs an action of one device and keeps its message. */
async function onDevice(uid: RdmUid, action: () => Promise<string | null>) {
  busy.add(uid);
  messages.delete(uid);
  try {
    const text = await action();
    if (text) messages.set(uid, { text, error: false });
  }
  catch (err) {
    messages.set(uid, { text: (err as Error).message ?? String(err), error: true });
  }
  finally {
    busy.delete(uid);
  }
}

/** UIDs this card switched Identify on (switched off on unmount). */
const identified = new Set<RdmUid>();

function identify(uid: RdmUid, on: boolean) {
  if (!runtime) return;
  void onDevice(uid, async () => {
    await runtime.store.identify(uid, on);
    if (on) identified.add(uid);
    else identified.delete(uid);
    return null;
  });
}

/** Adds devices (one undo step) and reports per device. */
async function add(uids: RdmUid[]) {
  if (!runtime || !uids.length) return;
  nodeBusy.value = true;
  for (const uid of uids) busy.add(uid);
  try {
    const outcomes = await addDevices(runtime, uids);
    for (const o of outcomes) {
      if (o.error) messages.set(o.uid, { text: o.error, error: true });
      else if (o.warnings.length) messages.set(o.uid, { text: o.warnings.join(' '), error: false });
      else messages.delete(o.uid);
    }
    const added = outcomes.filter(o => o.fixtureId !== undefined).length;
    summary.value = uids.length > 1 ? { text: `${added} of ${uids.length} devices added`, error: added < uids.length } : null;
  }
  finally {
    nodeBusy.value = false;
    for (const uid of uids) busy.delete(uid);
  }
}

function assign(uid: RdmUid) {
  if (!runtime) return;
  void onDevice(uid, async () => `Moved to address ${await assignFreeAddress(runtime, uid)}`);
}

/** Auto-address: all linked devices of the node, gap-free in canvas order. */
async function autoAddressNode() {
  const nodeId = props.connector.nodeId.value;
  if (!runtime || !nodeId) return;
  nodeBusy.value = true;
  summary.value = null;
  try {
    const outcomes = await autoAddress(runtime, nodeId);
    for (const o of outcomes) {
      if (o.error) messages.set(o.uid, { text: o.error, error: true });
      else messages.delete(o.uid);
    }
    const failed = outcomes.filter(o => o.error).length;
    summary.value = { text: failed ? `Auto-address: ${failed} of ${outcomes.length} devices failed` : `Auto-address: ${outcomes.length} devices re-addressed`, error: failed > 0 };
  }
  finally {
    nodeBusy.value = false;
  }
}

/** Rediscover: flush the TOD of every output port (full RDM discovery). */
async function rediscover() {
  const nodeId = props.connector.nodeId.value;
  if (!runtime || !nodeId) return;
  nodeBusy.value = true;
  summary.value = null;
  try {
    await runtime.store.rediscover(nodeId, props.connector.ports.value);
  }
  catch (err) {
    summary.value = { text: (err as Error).message ?? String(err), error: true };
  }
  finally {
    nodeBusy.value = false;
  }
}

// Identify auto-off when the card closes (D9).
onBeforeUnmount(() => {
  for (const uid of identified) void runtime?.store.identify(uid, false).catch(() => {});
  identified.clear();
});
</script>

<template>
  <div class="flex flex-col gap-1">
    <div class="flex items-center gap-2">
      <span class="text-xs font-medium text-muted-foreground">Devices</span>
      <span class="text-[10px] text-muted-foreground/80">{{ rows.length }} found</span>
      <span class="ml-auto flex items-center gap-1 text-[11px]">
        <button
          class="px-1.5 py-0.5 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          :disabled="nodeBusy || !addable.length"
          :title="addable.length ? `Add ${addable.length} devices with their current address and mode (one undo step)` : 'No new devices'"
          @click="add(addable.map(r => r.uid))"
        >
          Add all
        </button>
        <button
          class="px-1.5 py-0.5 rounded border border-border hover:bg-accent transition-colors disabled:opacity-50"
          :disabled="nodeBusy || !hasLinked"
          title="Re-address all linked devices of this node gap-free in canvas order"
          @click="autoAddressNode"
        >
          Auto-address
        </button>
        <button
          class="px-1.5 py-0.5 rounded border border-border hover:bg-accent transition-colors disabled:opacity-50"
          :disabled="nodeBusy || !connector.node.value"
          title="Clear the device lists of the node's ports and search again"
          @click="rediscover"
        >
          Rediscover
        </button>
      </span>
    </div>
    <p v-if="!runtime" class="text-[11px] text-muted-foreground">Device discovery is not active.</p>
    <p v-else-if="!rows.length" class="text-[11px] text-muted-foreground">
      {{ connector.node.value ? 'No RDM devices found on the node’s ports.' : 'The node is offline.' }}
    </p>
    <DeviceRow
      v-for="row in rows"
      :key="row.uid"
      :row="row"
      :busy="busy.has(row.uid)"
      :message="messages.get(row.uid) ?? null"
      @identify="identify(row.uid, $event)"
      @add="add([row.uid])"
      @assign="assign(row.uid)"
    />
    <p v-if="summary" class="text-[11px]" :class="summary.error ? 'text-destructive' : 'text-muted-foreground'">{{ summary.text }}</p>
  </div>
</template>

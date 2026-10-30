/**
 * Actions on the RDM devices of one node (plan M6.1, D9, D12), shared by
 * the port blocks of the connector card (WP13): Identify (switched off when
 * the card closes), Add / Add all (one undo step), Assign free address,
 * Auto-address of the node and Rediscover (ArtTodControl flush) of one or
 * all ports. Keeps per-device busy flags and messages and one summary line
 * per scope (`node` or a port key), so each port block shows its own.
 *
 * Moved out of the former all-ports device list; the logic is unchanged.
 */
import { onBeforeUnmount, reactive, ref, type Ref } from 'vue';
import type { NodeId, PortRef, RdmUid } from '../bridge/protocol-model';
import { addDevices } from './add-devices';
import { assignFreeAddress, autoAddress } from './addressing';
import type { DeviceRuntime } from './device-runtime';

/** Result line of a node or port action. */
export interface ActionSummary {
  /** `node`, or the port key (`1.0`) the action ran on. */
  scope: string;
  text: string;
  error: boolean;
}

/** What `useDeviceActions` returns. */
export interface DeviceActions {
  /** UIDs with an action in flight. */
  busy: Set<RdmUid>;
  /** Per-device result of the last action. */
  messages: Map<RdmUid, { text: string; error: boolean }>;
  /** A node or port action is running. */
  nodeBusy: Ref<boolean>;
  /** Result of the last node or port action. */
  summary: Ref<ActionSummary | null>;
  identify: (uid: RdmUid, on: boolean) => void;
  add: (uids: RdmUid[], scope?: string) => Promise<void>;
  assign: (uid: RdmUid) => void;
  autoAddressNode: () => Promise<void>;
  rediscover: (ports: readonly PortRef[], scope?: string) => Promise<void>;
}

/** Device actions of the node `nodeId()` (call in a component's setup). */
export function useDeviceActions(runtime: DeviceRuntime | null, nodeId: () => NodeId | null): DeviceActions {
  const busy = reactive(new Set<RdmUid>());
  const messages = reactive(new Map<RdmUid, { text: string; error: boolean }>());
  const nodeBusy = ref(false);
  const summary = ref<ActionSummary | null>(null);

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
  async function add(uids: RdmUid[], scope = 'node') {
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
      summary.value = uids.length > 1 ? { scope, text: `${added} of ${uids.length} devices added`, error: added < uids.length } : null;
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
    const id = nodeId();
    if (!runtime || !id) return;
    nodeBusy.value = true;
    summary.value = null;
    try {
      const outcomes = await autoAddress(runtime, id);
      for (const o of outcomes) {
        if (o.error) messages.set(o.uid, { text: o.error, error: true });
        else messages.delete(o.uid);
      }
      const failed = outcomes.filter(o => o.error).length;
      summary.value = {
        scope: 'node',
        text: failed ? `Auto-address: ${failed} of ${outcomes.length} devices failed` : `Auto-address: ${outcomes.length} devices re-addressed`,
        error: failed > 0,
      };
    }
    finally {
      nodeBusy.value = false;
    }
  }

  /** Rediscover: flush the TOD of `ports` (full RDM discovery). */
  async function rediscover(ports: readonly PortRef[], scope = 'node') {
    const id = nodeId();
    if (!runtime || !id) return;
    nodeBusy.value = true;
    summary.value = null;
    try {
      await runtime.store.rediscover(id, ports);
    }
    catch (err) {
      summary.value = { scope, text: (err as Error).message ?? String(err), error: true };
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

  return { busy, messages, nodeBusy, summary, identify, add, assign, autoAddressNode, rediscover };
}

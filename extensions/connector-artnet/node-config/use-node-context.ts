/**
 * Shared plumbing of the node configuration sections (plan M7.3): the
 * backend and node directory a section talks to, the live node state, a
 * command runner with busy/error state, and the node's `rdmDescribe`
 * result shared by all sections of one card (provide/inject).
 *
 * State always comes from the directory (bridge events) and from replies,
 * never from what was sent (D5, last-writer-wins).
 */
import { computed, inject, onScopeDispose, provide, ref, shallowRef, watch, type ComputedRef, type InjectionKey, type Ref, type ShallowRef } from 'vue';
import type { ArtNetBackend } from '../bridge/backend';
import type { NodeDirectory } from '../bridge/node-directory';
import type { RdmAddress } from '../bridge/protocol-messages';
import type { NodeState, RdmDeviceDescription } from '../bridge/protocol-model';
import { getArtNetBackend, getNodeDirectory } from '../bridge/shared';
import { isPixelmapperNode } from '../rdm/parameter-form/known-parameters';
import { uidManufacturer } from '../rdm/parameter-form/parameter-fields';
import { describeNodeError } from './device-rules';

// ── Context ────────────────────────────────────

/** Props every section takes. */
export interface NodeConfigProps {
  /** Node to configure (its `nodeId`, the RDM UID for the Pixelmapper Node). */
  nodeId: string;
  /** Backend to use; default the app-wide bridge connection. */
  backend?: ArtNetBackend;
  /** Node directory to read from; default the app-wide one. */
  directory?: NodeDirectory;
}

/** What a section works with. */
export interface NodeContext {
  backend: ArtNetBackend;
  directory: NodeDirectory;
  /** Live node state; null while the node or the bridge is away. */
  node: ComputedRef<NodeState | null>;
  /** The bridge is connected. */
  connected: ComputedRef<boolean>;
  /** Commands can be sent: bridge connected and node present. */
  online: ComputedRef<boolean>;
}

/** Resolves backend, directory and the live node of a section's props. */
export function useNodeContext(props: NodeConfigProps): NodeContext {
  const backend = props.backend ?? getArtNetBackend();
  const directory = props.directory ?? getNodeDirectory();
  const node = computed(() => directory.getNode(props.nodeId) ?? null);
  const connected = computed(() => backend.state.value.kind === 'connected');
  const online = computed(() => connected.value && node.value !== null);
  return { backend, directory, node, connected, online };
}

// ── Commands ───────────────────────────────────

/** Busy/error state around node commands. */
export interface CommandRunner {
  /** Key of the running command, null when idle. */
  busy: Ref<string | null>;
  /** Message of the last failure, null after a success. */
  error: Ref<string | null>;
  /** Runs `fn` under `key`; resolves true on success, false on failure (message in `error`). */
  run: (key: string, fn: () => Promise<unknown>) => Promise<boolean>;
}

/** Creates a command runner (one per independently failing area, e.g. per port). */
export function useCommandRunner(): CommandRunner {
  const busy = ref<string | null>(null);
  const error = ref<string | null>(null);
  async function run(key: string, fn: () => Promise<unknown>): Promise<boolean> {
    busy.value = key;
    error.value = null;
    try {
      await fn();
      return true;
    }
    catch (err) {
      error.value = describeNodeError(err);
      return false;
    }
    finally {
      if (busy.value === key) busy.value = null;
    }
  }
  return { busy, error, run };
}

// ── Node RDM description ───────────────────────

/** The node's `rdmDescribe` result and how to address its RDM responder. */
export interface NodeDescription {
  description: ShallowRef<RdmDeviceDescription | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  /** RDM address of the node's own responder (its UID via its first port, contract §6.3); null without UID. */
  address: ComputedRef<RdmAddress | null>;
  /** The node is a Pixelmapper Node (pids.toml PIDs apply). */
  pixelmapperNode: ComputedRef<boolean>;
  /** Reads the description again (bypassing the bridge's cache). */
  refresh: () => Promise<void>;
}

/** Injection key of the card-wide description. */
export const NODE_DESCRIPTION_KEY: InjectionKey<NodeDescription> = Symbol('artnet-device-description');

/** True when `value` has the fields the sections rely on (guards against malformed bridge answers). */
export function isDeviceDescription(value: unknown): value is RdmDeviceDescription {
  const d = value as Partial<RdmDeviceDescription> | null;
  return !!d && typeof d.uid === 'string' && typeof d.deviceInfo?.deviceModelId === 'number'
    && Array.isArray(d.supportedParameters) && Array.isArray(d.parameterDescriptions) && Array.isArray(d.errors);
}

/** Loads the node's description when its UID is known and the bridge is connected. */
export function useNodeDescription(ctx: NodeContext): NodeDescription {
  const description = shallowRef<RdmDeviceDescription | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const address = computed<RdmAddress | null>(() => {
    const node = ctx.node.value;
    const first = node?.ports[0];
    return node?.uid && first ? { nodeId: node.nodeId, port: { ...first.port }, uid: node.uid } : null;
  });
  // Stable identity of the address: the computed above re-creates the object on every node event.
  // The node's firmware is part of it: after an update the PIDs and their descriptions may differ.
  const addressKey = computed(() => (address.value
    ? `${address.value.nodeId}|${address.value.uid}|${address.value.port.bind}.${address.value.port.index}|${ctx.node.value?.firmware ?? ''}`
    : ''));
  const pixelmapperNode = computed(() => {
    const d = description.value;
    return !!d && isPixelmapperNode(uidManufacturer(d.uid), d.deviceInfo.deviceModelId);
  });

  let seq = 0;
  /** Reads the description (the latest request wins). */
  async function load(refresh: boolean): Promise<void> {
    const a = address.value;
    const mine = ++seq;
    if (!a || !ctx.connected.value) {
      loading.value = false;
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const result = await ctx.backend.request('rdmDescribe', { ...a, ...(refresh ? { refresh: true } : {}) }, { timeoutMs: 20_000 });
      if (mine !== seq) return;
      if (isDeviceDescription(result)) description.value = result;
      else error.value = 'The bridge sent an incomplete device description';
    }
    catch (err) {
      if (mine === seq) error.value = describeNodeError(err);
    }
    finally {
      if (mine === seq) loading.value = false;
    }
  }

  // Another node/UID/firmware, or the bridge (re)connected: read again. The last
  // good description stays while the node is briefly away (e.g. after an IP change).
  let loadedFor = '';
  watch([addressKey, ctx.connected], ([key, connected]) => {
    if (!connected) {
      loadedFor = '';
      return;
    }
    if (!key || key === loadedFor) return;
    if (description.value && description.value.uid !== key.split('|')[1]) description.value = null;
    loadedFor = key;
    void load(false);
  }, { immediate: true });
  onScopeDispose(() => { seq++; });

  return { description, loading, error, address, pixelmapperNode, refresh: () => load(true) };
}

/** Provides one description for all sections and port blocks of a card. */
export function provideNodeDescription(ctx: NodeContext): NodeDescription {
  const shared = useNodeDescription(ctx);
  provide(NODE_DESCRIPTION_KEY, shared);
  return shared;
}

/** The card's description, or an own one when a section is mounted alone. */
export function useSharedNodeDescription(ctx: NodeContext): NodeDescription {
  return inject(NODE_DESCRIPTION_KEY, null) ?? useNodeDescription(ctx);
}

/**
 * `artnet-node` connector: one connector per Art-Net node (plan D6, M5.3).
 *
 * Config = node identity (UID, else MAC — `nodeId`), the last known IP
 * (followed from bridge events) and the order of the node's output ports.
 * Outputs = the node's output ports; output `i` maps to a Pixelmapper
 * universe like any connector (default: the port's Port-Address, D7).
 * Status comes from the shared backend and from whether the node answers.
 * DMX goes through the shared backend, never directly (M5.4).
 */
import { computed, effectScope, ref, shallowReactive, shallowRef, watch, type ComputedRef, type EffectScope, type Ref, type ShallowRef } from 'vue';
import { ConnectorBase, connectors } from '@pixelmapper/extension-api';
import type { ArtNetBackend } from '../bridge/backend';
import type { NodeDirectory } from '../bridge/node-directory';
import type { NodeId, NodeState, PortRef } from '../bridge/protocol-model';
import { parsePortKey, portAddressOf, portKey, samePort } from '../bridge/protocol-model';
import { getArtNetBackend, getNodeDirectory, retainArtNetDiscovery } from '../bridge/shared';
import { nodeConnectorStatus } from './node-status';
import { isOutputPort, outputPortsOf, reconcileOutputs, sameOutputs } from './output-ports';

/** Connector type id. */
export const NODE_CONNECTOR_TYPE = 'artnet-node';

/** Backend and directory a connector uses (injectable for tests). */
export interface NodeConnectorDeps {
  backend: ArtNetBackend;
  directory: NodeDirectory;
  /**
   * Keeps discovery running while the connector lives; returns the release
   * function. Default: `retainArtNetDiscovery` of the shared backend; when
   * absent (tests) the connector just starts `backend`.
   */
  retain?: () => () => void;
}

/**
 * Node connectors that are live (connected by the host and not removed).
 * The host disconnects a connector only when it is removed or the user
 * changes (`alwaysConnected`), so this is the set of configured nodes.
 */
export const activeNodeConnectors: Set<ArtNetNodeConnector> = shallowReactive(new Set());

export class ArtNetNodeConnector extends ConnectorBase {
  readonly meta = { type: NODE_CONNECTOR_TYPE, label: 'Art-Net node', icon: 'network' };

  /** Node identity (UID or `mac:…`); null until known (added by IP). */
  readonly nodeId: Ref<NodeId | null> = ref(null);
  /** Last known IP; for manual nodes also the unicast poll target. */
  readonly ip: Ref<string | null> = ref(null);
  /** Added by IP: the bridge polls `ip` directly. */
  readonly manual: Ref<boolean> = ref(false);
  /** Output ports in output order (kept while the node is offline). */
  readonly ports: ShallowRef<PortRef[]> = shallowRef([]);
  /** Live state of the node, null while it does not answer. */
  readonly node: ComputedRef<NodeState | null>;

  private scope: EffectScope | null = null;
  private releasePoll: (() => void) | null = null;
  private releaseDiscovery: (() => void) | null = null;
  private offEvents: (() => void)[] = [];
  private injected: NodeConnectorDeps | null;

  constructor(id: string, deps?: NodeConnectorDeps) {
    super(id);
    this.injected = deps ?? null;
    this.node = computed(() => {
      const dir = this.deps.directory;
      if (this.nodeId.value) return dir.getNode(this.nodeId.value) ?? null;
      return this.ip.value ? dir.findByIp(this.ip.value) ?? null : null;
    });
  }

  /** Restores an instance from a stored config. */
  static fromConfig(id: string, config: Record<string, unknown>, deps?: NodeConnectorDeps): ArtNetNodeConnector {
    const c = new ArtNetNodeConnector(id, deps);
    c.applyConfig(config);
    return c;
  }

  /** Config of a connector for a discovered node (outputs = its output ports, default mapping). */
  static configForNode(node: NodeState): Record<string, unknown> {
    const { ports, mapping } = reconcileOutputs([], [], outputPortsOf(node));
    return { label: node.shortName || node.ip, nodeId: node.nodeId, ip: node.ip, manual: false, ports: ports.map(portKey), outputCount: ports.length, outputMapping: mapping };
  }

  // ── Lifecycle ────────────────────────────────

  /** Starts following the node (idempotent; a second call = Retry → reconnect the bridge now). */
  async connect(): Promise<void> {
    const { backend } = this.deps;
    if (this.scope) return backend.reconnectNow();
    activeNodeConnectors.add(this);
    // Discovery runs while at least one node connector exists (A.2 policy).
    const { retain } = this.deps;
    if (retain) this.releaseDiscovery = retain();
    else backend.start();
    this.autoReconnect.value = true;
    this.scope = effectScope(true);
    this.scope.run(() => {
      watch(this.node, (node, prev) => this.onNodeChange(node, prev ?? null), { immediate: true });
      watch([backend.state, backend.dmxError, this.node, this.nodeId, this.ip], () => this.updateStatus(), { immediate: true });
      watch([this.manual, this.ip], ([manual, ip]) => {
        this.releasePoll?.();
        this.releasePoll = manual && ip ? backend.addPollTarget(ip) : null;
      }, { immediate: true });
    });
    this.offEvents.push(backend.on('diag', (e) => {
      if (e.nodeId && e.nodeId === this.nodeId.value) this.pushLog(`[diag ${e.priority}] ${e.text}`);
    }));
  }

  /** Stops following the node (the host calls this when the connector is removed). */
  async disconnect(): Promise<void> {
    this.scope?.stop();
    this.scope = null;
    this.releasePoll?.();
    this.releasePoll = null;
    this.releaseDiscovery?.();
    this.releaseDiscovery = null;
    for (const off of this.offEvents) off();
    this.offEvents = [];
    activeNodeConnectors.delete(this);
    this.autoReconnect.value = false;
    this.status.value = 'disconnected';
    this.errorMessage.value = null;
  }

  /** No connection for the user to manage: the bridge connection is shared. */
  override alwaysConnected(): boolean {
    return true;
  }

  override canAutoConnect(): boolean {
    return true;
  }

  // ── Config ───────────────────────────────────

  override getConfig(): Record<string, unknown> {
    return { ...super.getConfig(), nodeId: this.nodeId.value, ip: this.ip.value, manual: this.manual.value, ports: this.ports.value.map(portKey) };
  }

  override applyConfig(config: Record<string, unknown>): void {
    if (Array.isArray(config.ports)) {
      const ports = config.ports.map(k => (typeof k === 'string' ? parsePortKey(k) : null)).filter((p): p is PortRef => !!p);
      this.ports.value = ports;
      this.setOutputCount(ports.length);
    }
    super.applyConfig(config);
    if ('nodeId' in config) this.nodeId.value = typeof config.nodeId === 'string' && config.nodeId ? config.nodeId : null;
    if ('ip' in config) this.ip.value = typeof config.ip === 'string' && config.ip ? config.ip : null;
    if (typeof config.manual === 'boolean') this.manual.value = config.manual;
  }

  // ── DMX out (M5.4) ───────────────────────────

  /** Sends the universe to every output port mapped to it (fire-and-forget). */
  override sendFrame(dmxBuffer: Uint8Array, universe?: number): void {
    const node = this.node.value;
    if (!node || !universe) return;
    const ports = this.ports.value;
    const mapping = this.outputMapping.value;
    for (let i = 0; i < ports.length; i++) {
      if (mapping[i] !== universe) continue;
      const port = node.ports.find(p => samePort(p.port, ports[i]!));
      // Only ports that output now: a port switched to input carries no output Port-Address (contract §4).
      if (!port || !isOutputPort(port)) continue;
      this.deps.backend.sendDmx({ nodeId: node.nodeId, portAddress: portAddressOf(port) }, dmxBuffer);
    }
  }

  // ── Internals ────────────────────────────────

  /** Shared backend/directory unless injected. */
  private get deps(): NodeConnectorDeps {
    return this.injected ?? { backend: getArtNetBackend(), directory: getNodeDirectory(), retain: retainArtNetDiscovery };
  }

  /**
   * Follows identity, IP and output ports of the node (state only from the
   * network, D5) and saves what it learned, even while the card is closed.
   */
  private onNodeChange(node: NodeState | null, prev: NodeState | null) {
    if (!node) {
      if (prev) this.pushLog(`[artnet] ${prev.shortName || prev.nodeId} offline`);
      return;
    }
    if (!prev) this.pushLog(`[artnet] ${node.shortName || node.nodeId} online at ${node.ip}`);
    let learned = false;
    if (this.nodeId.value !== node.nodeId) {
      this.nodeId.value = node.nodeId;
      learned = true;
    }
    if (this.ip.value !== node.ip) {
      if (prev && this.ip.value) this.pushLog(`[artnet] IP changed ${this.ip.value} → ${node.ip}`);
      this.ip.value = node.ip;
      learned = true;
    }
    if (!this.label.value) {
      this.label.value = node.shortName || node.ip;
      learned = true;
    }
    const next = reconcileOutputs(this.ports.value, this.outputMapping.value, outputPortsOf(node));
    if (!sameOutputs(this.ports.value, this.outputMapping.value, next.ports, next.mapping)) {
      this.ports.value = next.ports;
      this.outputCount = next.ports.length;
      this.outputMapping.value = next.mapping;
      learned = true;
    }
    if (learned) this.persistConfig();
  }

  /** Asks the host to save the current config (API 1.4); there is no host in unit tests. */
  private persistConfig() {
    try {
      connectors.persist(this.id);
    }
    catch { /* no host */ }
  }

  private updateStatus() {
    const { backend } = this.deps;
    const { status, message } = nodeConnectorStatus(backend.state.value, this.node.value, { nodeId: this.nodeId.value, ip: this.ip.value }, backend.dmxError.value);
    this.status.value = status;
    this.errorMessage.value = message;
  }
}

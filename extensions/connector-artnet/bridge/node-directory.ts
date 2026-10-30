/**
 * Reactive table of the Art-Net nodes and TODs the backend reports.
 *
 * Built only from the backend's events and its `nodes` snapshot (D5:
 * last-writer-wins, state comes from the network). Cleared while the
 * backend is not connected — without a bridge nothing is known. One shared
 * instance per app (`getNodeDirectory()` in `shared.ts`); connectors, the
 * suggestions and later the RDM device list (M6) read from it.
 */
import { shallowReactive, watch, type WatchStopHandle } from 'vue';
import type { ArtNetBackend } from './backend';
import type { NodeId, NodeState, PortRef, Tod } from './protocol-model';
import { portKey } from './protocol-model';

/** Map key of a TOD. */
function todKey(nodeId: NodeId, port: PortRef): string {
  return `${nodeId}|${portKey(port)}`;
}

export class NodeDirectory {
  /** Known nodes by id (reactive). */
  readonly nodes: Map<NodeId, NodeState> = shallowReactive(new Map());
  /** Last complete TOD per node port (reactive). */
  readonly tods: Map<string, Tod> = shallowReactive(new Map());

  private offs: (() => void)[] = [];
  private stopWatch: WatchStopHandle;

  constructor(private readonly backend: ArtNetBackend) {
    this.offs.push(
      backend.on('node', e => { this.nodes.set(e.node.nodeId, e.node); }),
      backend.on('nodeGone', e => this.removeNode(e.nodeId)),
      backend.on('tod', ({ type: _type, ...tod }) => { this.tods.set(todKey(tod.nodeId, tod.port), tod); }),
    );
    this.stopWatch = watch(() => backend.state.value.kind, (kind) => {
      if (kind === 'connected') void this.refresh();
      else this.clear();
    }, { immediate: true });
  }

  /** A node by id. */
  getNode(nodeId: NodeId): NodeState | undefined {
    return this.nodes.get(nodeId);
  }

  /** The node currently answering from `ip`. */
  findByIp(ip: string): NodeState | undefined {
    for (const node of this.nodes.values()) if (node.ip === ip) return node;
    return undefined;
  }

  /** The last TOD of a node port. */
  todOf(nodeId: NodeId, port: PortRef): Tod | undefined {
    return this.tods.get(todKey(nodeId, port));
  }

  /** All nodes, sorted by short name then IP. */
  list(): NodeState[] {
    return [...this.nodes.values()].sort((a, b) => a.shortName.localeCompare(b.shortName) || a.ip.localeCompare(b.ip, undefined, { numeric: true }));
  }

  /** Replaces the tables with the bridge's snapshot. */
  async refresh(): Promise<void> {
    try {
      const { nodes, tods } = await this.backend.request('nodes', {});
      this.clear();
      for (const node of nodes) this.nodes.set(node.nodeId, node);
      for (const tod of tods) this.tods.set(todKey(tod.nodeId, tod.port), tod);
    }
    catch (err) {
      console.warn('[artnet] node snapshot failed:', err);
    }
  }

  /** Stops listening. */
  dispose(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.stopWatch();
    this.clear();
  }

  private removeNode(nodeId: NodeId) {
    this.nodes.delete(nodeId);
    for (const [key, tod] of this.tods) if (tod.nodeId === nodeId) this.tods.delete(key);
  }

  private clear() {
    this.nodes.clear();
    this.tods.clear();
  }
}

/**
 * The ports the Art-Net card shows (WP13): every port of the live node, or
 * — while the node does not answer — the connector's stored output ports.
 * Each entry joins the node's port state with the connector's universe
 * mapping (plan D7), so one port block shows both.
 */
import { computed, type ComputedRef } from 'vue';
import type { PortRef, PortState } from '../bridge/protocol-model';
import { portAddressOf, portKey, portLabel, samePort } from '../bridge/protocol-model';
import type { ArtNetNodeConnector } from '../node/node-connector';
import { portAddressForUniverse } from '../node/output-ports';

/** One port of the card. */
export interface PortEntry {
  /** `1.0` (BindIndex.index). */
  key: string;
  port: PortRef;
  /** `Port 2`. */
  label: string;
  /** Live state; null while the node does not answer. */
  state: PortState | null;
  /** Index among the connector's outputs (its universe mapping); -1 when the port does not output now. */
  outputIndex: number;
  /** Pixelmapper universe of the output (0 = off); 0 for ports that are no output. */
  universe: number;
  /** The node's Port-Address of the port's current direction; null while offline. */
  portAddress: number | null;
  /** The node's Port-Address differs from the mapped universe (DMX still arrives). */
  differs: boolean;
}

/** Entries of the card's ports, in node order. */
export function usePortEntries(connector: ArtNetNodeConnector): ComputedRef<PortEntry[]> {
  return computed(() => {
    const node = connector.node.value;
    const outputs = connector.ports.value;
    const refs: PortRef[] = node ? node.ports.map(p => p.port) : outputs;
    return refs.map((port) => {
      const state = node?.ports.find(p => samePort(p.port, port)) ?? null;
      const outputIndex = outputs.findIndex(p => samePort(p, port));
      const universe = outputIndex >= 0 ? connector.outputMapping.value[outputIndex] ?? 0 : 0;
      const portAddress = state ? portAddressOf(state) : null;
      const target = universe > 0 ? portAddressForUniverse(universe) : null;
      return {
        key: portKey(port),
        port,
        label: portLabel(port, refs),
        state,
        outputIndex,
        universe,
        portAddress,
        differs: portAddress !== null && target !== null && portAddress !== target,
      };
    });
  });
}

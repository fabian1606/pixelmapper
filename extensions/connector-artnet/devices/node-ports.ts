/**
 * Node ports as the device features see them: the Pixelmapper universe a
 * node port outputs (from its `artnet-node` connector, D7) and display
 * names for messages. Reads the live node connectors, so it is reactive
 * inside `computed`s.
 */
import type { NodeId, PortRef } from '../bridge/protocol-model';
import { portLabel, samePort } from '../bridge/protocol-model';
import { activeNodeConnectors, type ArtNetNodeConnector } from '../node/node-connector';
import { defaultUniverse } from '../node/output-ports';

/** The live connector of a node, or null when the node has none. */
export function connectorOfNode(nodeId: NodeId): ArtNetNodeConnector | null {
  for (const c of activeNodeConnectors) if (c.nodeId.value === nodeId) return c;
  return null;
}

/**
 * Pixelmapper universe of a node output port: the connector's mapping, or
 * the default (the port's Port-Address) while the output is off. Null when
 * the node has no connector or the port is not one of its outputs.
 */
export function portUniverse(nodeId: NodeId, port: PortRef): number | null {
  const c = connectorOfNode(nodeId);
  if (!c) return null;
  const i = c.ports.value.findIndex(p => samePort(p, port));
  if (i < 0) return null;
  const mapped = c.outputMapping.value[i] ?? 0;
  if (mapped > 0) return mapped;
  const state = c.node.value?.ports.find(p => samePort(p.port, port));
  return state ? defaultUniverse(state) : null;
}

/** Name of a node for messages: the connector label, else the node's short name, else its id. */
export function nodeDisplayName(nodeId: NodeId): string {
  const c = connectorOfNode(nodeId);
  return c?.label.value || c?.node.value?.shortName || nodeId;
}

/** `Port 3` (or `Port 1.2` on multi-port BindIndexes) of a node. */
export function portDisplayName(nodeId: NodeId, port: PortRef): string {
  const c = connectorOfNode(nodeId);
  const all = c?.node.value?.ports.map(p => p.port) ?? c?.ports.value ?? [port];
  return portLabel(port, all);
}

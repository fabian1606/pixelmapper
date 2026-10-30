/**
 * Output ports of a node as connector outputs (plan D7, M5.3/M5.5).
 *
 * Output `i` of an `artnet` connector is the node's `i`-th output port
 * (ordered by BindIndex, then port). The stored port list keeps the order
 * stable while the node is offline; the mapping per port defaults to the
 * port's Port-Address itself (D7, changed in WP3): the node's factory
 * Port-Addresses are 1–4 and Art-Net 4 deprecates Port-Address 0, so
 * U1–U4 meet ports 1–4 without writing anything. Port-Address 0 maps to U1.
 */
import type { NodeState, PortRef, PortState } from '../bridge/protocol-model';
import { isPortAddress, portAddressOf, portKey, samePort } from '../bridge/protocol-model';

/** True when the port currently outputs DMX (PortTypes show the current direction). */
export function isOutputPort(port: PortState): boolean {
  return port.canOutput && (port.direction === 'output' || port.direction === 'both');
}

/** Ports of `node` that currently output DMX. */
export function outputPortsOf(node: NodeState): PortState[] {
  return node.ports.filter(isOutputPort);
}

/**
 * Default Pixelmapper universe of a port: its Port-Address (the field of
 * its current direction, `portAddressOf`; the deprecated Port-Address 0 → U1).
 */
export function defaultUniverse(port: PortState): number {
  return Math.max(1, portAddressOf(port));
}

/**
 * Port-Address that matches a 1-based Pixelmapper universe: the same number
 * (null when out of range, i.e. above 32767). The port mapping compares it
 * with the node's Port-Address to point out a difference.
 */
export function portAddressForUniverse(universe: number): number | null {
  return universe >= 1 && isPortAddress(universe) ? universe : null;
}

/**
 * Aligns the stored outputs with the node's current output ports: kept
 * ports keep their universe, new ports get the default, gone ports drop.
 */
export function reconcileOutputs(prevPorts: readonly PortRef[], prevMapping: readonly number[], nodePorts: readonly PortState[]): { ports: PortRef[]; mapping: number[] } {
  const prev = new Map(prevPorts.map((p, i) => [portKey(p), prevMapping[i] ?? 0]));
  return {
    ports: nodePorts.map(p => ({ ...p.port })),
    mapping: nodePorts.map(p => prev.get(portKey(p.port)) ?? defaultUniverse(p)),
  };
}

/**
 * Mapping of a manual target's outputs (universe + Port-Address each) onto
 * the node's output ports once the device answers ArtPoll: a port whose
 * Port-Address a manual output used gets that output's universe, the other
 * ports the default (D7).
 */
export function adoptManualOutputs(portAddresses: readonly number[], mapping: readonly number[], nodePorts: readonly PortState[]): { ports: PortRef[]; mapping: number[] } {
  const byAddress = new Map<number, number>();
  portAddresses.forEach((pa, i) => {
    if (!byAddress.has(pa) && (mapping[i] ?? 0) > 0) byAddress.set(pa, mapping[i]!);
  });
  return {
    ports: nodePorts.map(p => ({ ...p.port })),
    mapping: nodePorts.map(p => byAddress.get(portAddressOf(p)) ?? defaultUniverse(p)),
  };
}

/** Default Port-Address of a manual output for `universe` (the same number, D7; 0 when out of range). */
export function defaultManualPortAddress(universe: number): number {
  return portAddressForUniverse(universe) ?? 0;
}

/** True when two reconcile results describe the same outputs. */
export function sameOutputs(aPorts: readonly PortRef[], aMapping: readonly number[], bPorts: readonly PortRef[], bMapping: readonly number[]): boolean {
  return aPorts.length === bPorts.length
    && aPorts.every((p, i) => samePort(p, bPorts[i]!) && aMapping[i] === bMapping[i]);
}

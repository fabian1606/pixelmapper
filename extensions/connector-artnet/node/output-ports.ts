/**
 * Output ports of a node as connector outputs (plan D7, M5.3/M5.5).
 *
 * Output `i` of an `artnet-node` connector is the node's `i`-th output port
 * (ordered by BindIndex, then port). The stored port list keeps the order
 * stable while the node is offline; the mapping per port defaults to the
 * port's Port-Address + 1 (Pixelmapper universes are 1-based).
 */
import type { NodeState, PortRef, PortState } from '../bridge/protocol-model';
import { isPortAddress, portKey, samePort } from '../bridge/protocol-model';

/** Ports of `node` that currently output DMX (PortTypes show the current direction). */
export function outputPortsOf(node: NodeState): PortState[] {
  return node.ports.filter(p => p.canOutput && (p.direction === 'output' || p.direction === 'both'));
}

/** Default Pixelmapper universe of a port: its Port-Address + 1. */
export function defaultUniverse(port: PortState): number {
  return port.outputPortAddress + 1;
}

/** Port-Address that matches a 1-based Pixelmapper universe (null when out of range). */
export function portAddressForUniverse(universe: number): number | null {
  const pa = universe - 1;
  return isPortAddress(pa) ? pa : null;
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

/** True when two reconcile results describe the same outputs. */
export function sameOutputs(aPorts: readonly PortRef[], aMapping: readonly number[], bPorts: readonly PortRef[], bMapping: readonly number[]): boolean {
  return aPorts.length === bPorts.length
    && aPorts.every((p, i) => samePort(p, bPorts[i]!) && aMapping[i] === bMapping[i]);
}

/**
 * Checks writing new output Port-Addresses (contract `artAddress`): ports of
 * one BindIndex share Net and Sub-Net, so every port of a BindIndex that is
 * not written must keep bits 14–4 equal to the written ones. Returns an
 * error message, or null when the write is allowed.
 */
export function portAddressWriteError(node: NodeState, writes: readonly { port: PortRef; portAddress: number }[]): string | null {
  for (const w of writes) {
    if (!isPortAddress(w.portAddress)) return 'Port-Address out of range (0–32767)';
    if (!node.ports.some(p => samePort(p.port, w.port))) return 'The node has no such port';
  }
  for (const w of writes) {
    const group = w.portAddress >> 4;
    for (const other of node.ports) {
      if (other.port.bind !== w.port.bind) continue;
      const written = writes.find(x => samePort(x.port, other.port));
      const address = written ? written.portAddress : other.outputPortAddress;
      if (address >> 4 !== group) return 'Ports of one node share Net and Sub-Net — write all ports together or pick an address in the same Sub-Net';
    }
  }
  return null;
}

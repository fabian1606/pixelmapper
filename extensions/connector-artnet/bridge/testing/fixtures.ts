/**
 * Builders of contract-shaped test data (nodes, ports, TODs). Used by the
 * extension's tests and the fake backend; not used at runtime.
 */
import type { NodeState, NodeStatus, PortState, Tod } from '../protocol-model';

/** Status of a healthy Pixelmapper Node. */
export function makeStatus(overrides: Partial<NodeStatus> = {}): NodeStatus {
  return {
    indicator: 'normal',
    portAddressAuthority: 'network',
    bootedFromRom: false,
    rdmCapable: true,
    ubeaPresent: false,
    webConfig: false,
    dhcpConfigured: false,
    dhcpCapable: true,
    portAddress15Bit: true,
    sacnSwitchable: false,
    squawking: false,
    outputStyleSwitchable: false,
    rdmSwitchable: false,
    failsafe: 'hold',
    failsafeProgrammable: true,
    llrp: false,
    portDirectionSwitchable: true,
    rdmnet: false,
    backgroundQueue: false,
    backgroundDiscoveryControl: false,
    ...overrides,
  };
}

/** One DMX output port (bind 1) with Port-Address `portAddress`. */
export function makePort(index: number, portAddress: number, overrides: Partial<PortState> = {}): PortState {
  return {
    port: { bind: 1, index },
    protocol: 'dmx512',
    canOutput: true,
    canInput: true,
    direction: 'output',
    outputPortAddress: portAddress,
    inputPortAddress: portAddress,
    output: { data: false, merging: false, merge: 'htp', shortCircuit: false, sacn: false, rdm: true, style: 'continuous', discoveryRunning: false, backgroundDiscovery: true },
    input: { data: false, disabled: false, errors: false, sacn: false },
    ...overrides,
  };
}

/** A 4-port Pixelmapper Node (ports at Port-Address 0–3 unless given). */
export function makeNode(overrides: Partial<NodeState> = {}): NodeState {
  return {
    nodeId: '7FF0:8A1B2C3D',
    uid: '7FF0:8A1B2C3D',
    mac: '02:7f:f0:1b:2c:3d',
    ip: '2.27.44.61',
    interface: 'en7',
    shortName: 'PM Node',
    longName: 'Pixelmapper Node',
    nodeReport: '#0001 [0001] OK',
    firmware: 0x0100,
    estaMan: 0x7ff0,
    oem: 0,
    ubeaVersion: 0,
    style: 'node',
    refreshRate: 44,
    status: makeStatus(),
    raw: { status1: 0xe2, status2: 0x0c, status3: 0x28 },
    ports: [0, 1, 2, 3].map(i => makePort(i, i)),
    lastSeen: 1_761_336_000_000,
    ...overrides,
  };
}

/** A TOD of port `index` (bind 1). */
export function makeTod(nodeId: string, index: number, uids: string[], portAddress = index): Tod {
  return { nodeId, port: { bind: 1, index }, portAddress, available: true, uids: [...uids].sort() };
}

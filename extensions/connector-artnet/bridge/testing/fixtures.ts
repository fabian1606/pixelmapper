/**
 * Builders of contract-shaped test data (nodes, ports, TODs). Used by the
 * extension's tests and the fake backend; not used at runtime.
 *
 * The default node is a Pixelmapper Node as the node contract describes it:
 * 4 ports, one per BindIndex (1–4), Port-Addresses 1–4, OEM 0x00FF.
 */
import type { NodeState, NodeStatus, PortState, RdmDeviceDescription, RdmDeviceInfo, Tod } from '../protocol-model';

/** Status of a healthy Pixelmapper Node. */
export function makeStatus(overrides: Partial<NodeStatus> = {}): NodeStatus {
  return {
    indicator: 'normal',
    portAddressAuthority: 'network',
    bootedFromRom: false,
    rdmCapable: true,
    ubeaPresent: false,
    webConfig: false,
    dhcpConfigured: true,
    dhcpCapable: true,
    portAddress15Bit: true,
    sacnSwitchable: false,
    squawking: false,
    outputStyleSwitchable: true,
    rdmSwitchable: true,
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

/** One DMX output port at BindIndex `bind` with Port-Address `portAddress`. */
export function makePort(bind: number, portAddress: number, overrides: Partial<PortState> = {}): PortState {
  return {
    port: { bind, index: 0 },
    protocol: 'dmx512',
    canOutput: true,
    canInput: false,
    direction: 'output',
    outputPortAddress: portAddress,
    inputPortAddress: portAddress,
    output: { data: false, merging: false, merge: 'htp', shortCircuit: false, sacn: false, rdm: true, style: 'continuous', discoveryRunning: false, backgroundDiscovery: true },
    input: { data: false, disabled: false, errors: false, sacn: false },
    ...overrides,
  };
}

/** A Pixelmapper Node with 4 output ports (BindIndex 1–4, Port-Address 1–4). */
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
    oem: 0x00ff,
    ubeaVersion: 0,
    style: 'node',
    refreshRate: 44,
    status: makeStatus(),
    raw: { status1: 0xe2, status2: 0xce, status3: 0x28 },
    ports: [1, 2, 3, 4].map(bind => makePort(bind, bind)),
    lastSeen: 1_761_336_000_000,
    ...overrides,
  };
}

/** A TOD of the port at BindIndex `bind`. */
export function makeTod(nodeId: string, bind: number, uids: string[], portAddress = bind): Tod {
  return { nodeId, port: { bind, index: 0 }, portAddress, available: true, uids: [...uids].sort() };
}

// ── RDM devices ────────────────────────────────

/** Footprints of the XBAR500 tube personalities 1–4 (12, 3, 4, 13 channels). */
export const TUBE_FOOTPRINTS = [12, 3, 4, 13] as const;

/** DEVICE_INFO of an XBAR500 tube (personality 1 = 12 channels at address 1). */
export function makeDeviceInfo(overrides: Partial<RdmDeviceInfo> = {}): RdmDeviceInfo {
  const currentPersonality = overrides.currentPersonality ?? 1;
  return {
    rdmProtocolVersion: 0x0100,
    deviceModelId: 0x0001,
    productCategory: 0x0101, // PRODUCT_CATEGORY_FIXTURE_FIXED
    softwareVersionId: 0x00000500,
    dmxFootprint: TUBE_FOOTPRINTS[currentPersonality - 1] ?? 12,
    currentPersonality,
    personalityCount: 4,
    dmxStartAddress: 1,
    subDeviceCount: 0,
    sensorCount: 0,
    ...overrides,
  };
}

/**
 * `rdmDescribe` result of a tube with UID `uid` (labels, 4 personalities,
 * no SLOT_INFO). Pass `slots` for devices that describe their slots.
 */
export function makeDescription(uid: string, overrides: Partial<RdmDeviceDescription> = {}, info: Partial<RdmDeviceInfo> = {}): RdmDeviceDescription {
  return {
    uid,
    deviceInfo: makeDeviceInfo(info),
    manufacturerLabel: 'HfG Prototyping Lab',
    deviceModelDescription: 'XBAR500 LED Tube',
    deviceLabel: null,
    softwareVersionLabel: '0.5.0',
    bootSoftwareVersionId: 1,
    bootSoftwareVersionLabel: 'boot 1',
    personalities: TUBE_FOOTPRINTS.map((footprint, i) => ({ index: i + 1, footprint, description: `${footprint} ch` })),
    slots: [],
    supportedParameters: [0x0082, 0x00e0, 0x00e1, 0x00f0, 0x1000],
    parameterDescriptions: [],
    errors: [],
    ...overrides,
  };
}

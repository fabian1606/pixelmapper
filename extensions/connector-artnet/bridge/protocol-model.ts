/**
 * State shapes of the bridge WebSocket contract (`pmnet serve` ↔ app).
 *
 * Mirrors §3–§4 of `architecture/artnet-bridge-ws-protocol.md` 1:1. Every
 * change here is a contract change and goes into that document too. The
 * bridge builds and decodes all packets; these are the decoded shapes.
 */

// ── Identifiers ────────────────────────────────

/** Stable node identity: `"7FF0:8A1B2C3D"` (UID), `"mac:…"` or `"ip:…"`. */
export type NodeId = string;

/** RDM UID, `"MMMM:DDDDDDDD"` uppercase hex. */
export type RdmUid = string;

/** One port of a node: `BindIndex` of its ArtPollReply + index within that reply. */
export interface PortRef {
  /** BindIndex, 1–255. */
  bind: number;
  /** Port within that reply, 0–3. */
  index: number;
}

/** RDM broadcast UIDs (requests return `{ broadcast: true }`). */
export const RDM_BROADCAST_UID = 'FFFF:FFFFFFFF';

// ── Bridge ─────────────────────────────────────

/** A network interface of the host running the bridge. */
export interface NetInterface {
  name: string;
  ip: string;
  mask: string;
  mac: string | null;
}

/** State of the bridge's Art-Net UDP socket (port 6454). */
export interface UdpState {
  bound: boolean;
  port: number;
  /** Bind error, e.g. `"address in use"`. */
  error: string | null;
}

// ── Nodes ──────────────────────────────────────

/** Decoded Status1/2/3 of the node's root ArtPollReply. */
export interface NodeStatus {
  indicator: 'unknown' | 'locate' | 'mute' | 'normal';
  portAddressAuthority: 'unknown' | 'panel' | 'network';
  bootedFromRom: boolean;
  rdmCapable: boolean;
  ubeaPresent: boolean;
  webConfig: boolean;
  dhcpConfigured: boolean;
  dhcpCapable: boolean;
  portAddress15Bit: boolean;
  sacnSwitchable: boolean;
  squawking: boolean;
  outputStyleSwitchable: boolean;
  rdmSwitchable: boolean;
  failsafe: 'hold' | 'zero' | 'full' | 'scene';
  failsafeProgrammable: boolean;
  llrp: boolean;
  portDirectionSwitchable: boolean;
  rdmnet: boolean;
  backgroundQueue: boolean;
  backgroundDiscoveryControl: boolean;
}

/** Output flags of a port (GoodOutputA/B). */
export interface PortOutputState {
  data: boolean;
  merging: boolean;
  merge: 'htp' | 'ltp';
  shortCircuit: boolean;
  sacn: boolean;
  rdm: boolean;
  style: 'delta' | 'continuous';
  discoveryRunning: boolean;
  backgroundDiscovery: boolean;
}

/** Input flags of a port (GoodInput). */
export interface PortInputState {
  data: boolean;
  disabled: boolean;
  errors: boolean;
  sacn: boolean;
}

/** One port of a node. */
export interface PortState {
  port: PortRef;
  protocol: 'dmx512' | 'midi' | 'avab' | 'cmx' | 'adb' | 'artnet' | 'dali' | 'unknown';
  canOutput: boolean;
  canInput: boolean;
  /** Current direction (node contract §3). */
  direction: 'output' | 'input' | 'none';
  /** 15-bit Port-Address of the output (Net/Sub/SwOut). */
  outputPortAddress: number;
  /** 15-bit Port-Address of the input (Net/Sub/SwIn). */
  inputPortAddress: number;
  output: PortOutputState;
  input: PortInputState;
}

/** One Art-Net node, merged from all its ArtPollReplies. */
export interface NodeState {
  nodeId: NodeId;
  uid: RdmUid | null;
  mac: string | null;
  ip: string;
  interface: string | null;
  shortName: string;
  longName: string;
  nodeReport: string;
  /** VersInfoH << 8 | VersInfoL. */
  firmware: number;
  estaMan: number;
  oem: number;
  ubeaVersion: number;
  style: 'node' | 'controller' | 'media' | 'route' | 'backup' | 'config' | 'visual' | 'unknown';
  refreshRate: number;
  status: NodeStatus;
  raw: { status1: number; status2: number; status3: number };
  /** Every port of every BindIndex, ordered by bind, then index. */
  ports: PortState[];
  /** Last reply, ms since the Unix epoch (bridge clock). */
  lastSeen: number;
}

/** Table of devices of one port (ArtTodData, all blocks assembled). */
export interface Tod {
  nodeId: NodeId;
  port: PortRef;
  portAddress: number;
  /** False when the node answered TodNak. */
  available: boolean;
  /** Sorted ascending; empty when `!available`. */
  uids: RdmUid[];
}

// ── RDM ────────────────────────────────────────

/** DEVICE_INFO (0x0060). */
export interface RdmDeviceInfo {
  rdmProtocolVersion: number;
  deviceModelId: number;
  productCategory: number;
  softwareVersionId: number;
  dmxFootprint: number;
  /** 1-based. */
  currentPersonality: number;
  personalityCount: number;
  /** 1–512; 65535 = none. */
  dmxStartAddress: number;
  subDeviceCount: number;
  sensorCount: number;
}

/** DMX_PERSONALITY_DESCRIPTION (0x00E1). */
export interface RdmPersonality {
  /** 1-based. */
  index: number;
  footprint: number;
  description: string | null;
}

/** SLOT_INFO + SLOT_DESCRIPTION + DEFAULT_SLOT_VALUE of one slot. */
export interface RdmSlot {
  /** 0-based offset in the current personality. */
  offset: number;
  /** Slot type, E1.20 Table C-1. */
  type: number;
  /** Slot label id, E1.20 Table C-2. */
  labelId: number;
  description: string | null;
  defaultValue: number | null;
}

/** Data type names of PARAMETER_DESCRIPTION (E1.20 Table A-15). */
export type RdmDataTypeName = 'notDefined' | 'bitField' | 'ascii' | 'uint8' | 'int8' | 'uint16' | 'int16' | 'uint32' | 'int32' | 'manufacturer';

/** PARAMETER_DESCRIPTION (0x0051). */
export interface RdmParameterDescription {
  pid: number;
  pdlSize: number;
  dataType: number;
  dataTypeName: RdmDataTypeName;
  commandClass: 'get' | 'set' | 'getSet';
  type: number;
  unit: number;
  prefix: number;
  minValue: number;
  maxValue: number;
  defaultValue: number;
  description: string;
}

/** One STATUS_MESSAGES entry. */
export interface RdmStatusMessage {
  subDevice: number;
  statusType: 'none' | 'advisory' | 'warning' | 'error' | 'advisoryCleared' | 'warningCleared' | 'errorCleared';
  statusMessageId: number;
  dataValue1: number;
  dataValue2: number;
  text: string | null;
}

/** A PID that failed during `rdmDescribe`. */
export interface RdmDescribeError {
  pid: number;
  code: string;
  message: string;
  nackReason?: number;
}

/** Result of `rdmDescribe`: everything the UI needs about one device. */
export interface RdmDeviceDescription {
  uid: RdmUid;
  deviceInfo: RdmDeviceInfo;
  manufacturerLabel: string | null;
  deviceModelDescription: string | null;
  deviceLabel: string | null;
  softwareVersionLabel: string | null;
  bootSoftwareVersionId: number | null;
  bootSoftwareVersionLabel: string | null;
  personalities: RdmPersonality[];
  slots: RdmSlot[];
  supportedParameters: number[];
  parameterDescriptions: RdmParameterDescription[];
  errors: RdmDescribeError[];
}

/** Decoded parameter data (see the `RdmValue` table of the contract). */
export type RdmValue =
  | number
  | string
  | boolean
  | number[]
  | RdmDeviceInfo
  | RdmParameterDescription
  | RdmPersonality
  | RdmStatusMessage[]
  | { current: number; count: number }
  | { offset: number; description: string }
  | { offset: number; type: number; labelId: number }[]
  | { offset: number; value: number }[];

// ── Firmware ───────────────────────────────────

/** Trailer of a tube firmware image (node contract §9.1). */
export interface FirmwareImageInfo {
  format: number;
  manufacturerId: number;
  modelId: number;
  /** FW_VERSION_ID 0x00MMmmpp. */
  versionId: number;
  /** `"M.m.p"`. */
  version: string;
  length: number;
}

/** Phase of a firmware job, in order; the last three are terminal. */
export type FlashPhase = 'entering' | 'writing' | 'verifying' | 'finishing' | 'confirming' | 'done' | 'failed' | 'cancelled';

/** A firmware update job run by the bridge. */
export interface FlashJob {
  jobId: string;
  nodeId: NodeId;
  port: PortRef;
  uid: RdmUid;
  phase: FlashPhase;
  pagesDone: number;
  pagesTotal: number;
  rewrites: number;
  inBootloader: boolean;
  image: FirmwareImageInfo;
  error: { code: string; message: string } | null;
  result: { softwareVersionId: number; softwareVersionLabel: string | null } | null;
}

// ── DMX routes ─────────────────────────────────

/** Destination of DMX frames: a node (follows its IP) or a fixed IP. */
export type DmxRoute =
  | { route: number; nodeId: NodeId; portAddress: number }
  | { route: number; ip: string; portAddress: number };

// ── Helpers ────────────────────────────────────

/** Stable string key of a port, e.g. `"1.0"`. */
export function portKey(port: PortRef): string {
  return `${port.bind}.${port.index}`;
}

/** Parses a key made by `portKey`; null when malformed. */
export function parsePortKey(key: string): PortRef | null {
  const m = /^(\d+)\.(\d+)$/.exec(key);
  return m ? { bind: Number(m[1]), index: Number(m[2]) } : null;
}

/** True when both refer to the same port. */
export function samePort(a: PortRef, b: PortRef): boolean {
  return a.bind === b.bind && a.index === b.index;
}

/** Formats a 15-bit Port-Address as `Net:Sub:Uni` (e.g. `0:1:3`). */
export function formatPortAddress(portAddress: number): string {
  return `${(portAddress >> 8) & 0x7f}:${(portAddress >> 4) & 0x0f}:${portAddress & 0x0f}`;
}

/** True for a valid 15-bit Port-Address. */
export function isPortAddress(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 0x7fff;
}

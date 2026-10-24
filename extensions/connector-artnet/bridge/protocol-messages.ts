/**
 * Messages of the bridge WebSocket contract: events, commands with their
 * arguments and results, error codes and the version rule.
 *
 * Mirrors §1, §2, §5, §6 and §8 of `architecture/artnet-bridge-ws-protocol.md`.
 */
import type {
  DmxRoute,
  FirmwareImageInfo,
  FlashJob,
  NetInterface,
  NodeId,
  NodeState,
  PortRef,
  RdmDeviceDescription,
  RdmUid,
  RdmValue,
  Tod,
  UdpState,
} from './protocol-model';

/** Protocol version implemented by this app. */
export const PROTOCOL_VERSION = '1.0.0';

// ── Events (bridge → app) ──────────────────────

/** First message of every connection. */
export interface HelloEvent {
  type: 'hello';
  /** pmnet version. */
  bridge: string;
  /** Protocol semver. */
  protocol: string;
  interfaces: NetInterface[];
  udp: UdpState;
}

/** Interfaces or UDP socket changed. */
export interface BridgeStatusEvent {
  type: 'bridgeStatus';
  interfaces: NetInterface[];
  udp: UdpState;
}

/** A node appeared or changed. */
export interface NodeEvent {
  type: 'node';
  node: NodeState;
}

/** A node stopped answering (3 poll cycles). */
export interface NodeGoneEvent {
  type: 'nodeGone';
  nodeId: NodeId;
  lastSeen: number;
}

/** A complete TOD of one port. */
export interface TodEvent extends Tod {
  type: 'tod';
}

/** A queued RDM message fetched by the bridge. */
export interface RdmQueuedEvent {
  type: 'rdmQueued';
  nodeId: NodeId;
  port: PortRef;
  uid: RdmUid;
  subDevice: number;
  pid: number;
  data: string;
  value?: RdmValue;
}

/** ArtDiagData from a node. */
export interface DiagEvent {
  type: 'diag';
  nodeId: NodeId | null;
  ip: string;
  priority: 'low' | 'medium' | 'high' | 'critical' | 'volatile';
  logicalPort: number;
  text: string;
}

/** Progress of a firmware job. */
export interface FlashProgressEvent {
  type: 'flashProgress';
  job: FlashJob;
}

/** Bridge diagnostics. */
export interface LogEvent {
  type: 'log';
  level: 'debug' | 'info' | 'warn' | 'error';
  text: string;
  nodeId?: NodeId;
}

/** Events delivered to subscribers after the handshake, by type. */
export interface BridgeEventMap {
  bridgeStatus: BridgeStatusEvent;
  node: NodeEvent;
  nodeGone: NodeGoneEvent;
  tod: TodEvent;
  rdmQueued: RdmQueuedEvent;
  diag: DiagEvent;
  flashProgress: FlashProgressEvent;
  log: LogEvent;
}

/** Name of a subscribable event. */
export type BridgeEventType = keyof BridgeEventMap;

/** Any subscribable event. */
export type BridgeEvent = BridgeEventMap[BridgeEventType];

// ── Commands (app → bridge) ────────────────────

/** ArtTodControl commands: AtcFlush, AtcEnd, AtcIncOn, AtcIncOff. */
export type TodControlAction = 'flush' | 'end' | 'incOn' | 'incOff';

/** Addressing of an RDM request. */
export interface RdmAddress {
  nodeId: NodeId;
  port: PortRef;
  uid: RdmUid;
  /** Default 0 (root). */
  subDevice?: number;
}

/** Arguments of `rdmGet`: optional parameter data as hex or decoded. */
export interface RdmGetArgs extends RdmAddress {
  pid: number;
  data?: string;
  value?: RdmValue;
}

/** Arguments of `rdmSet`: exactly one of `data` / `value`. */
export type RdmSetArgs = RdmAddress & { pid: number } & ({ data: string; value?: never } | { value: RdmValue; data?: never });

/** Result of `rdmGet` / `rdmSet`. */
export interface RdmResult {
  data: string;
  value?: RdmValue;
  broadcast?: true;
}

/** Per-port changes of `artAddress`. */
export interface ArtAddressPortChange {
  port: PortRef;
  outputPortAddress?: number;
  inputPortAddress?: number;
  direction?: 'output' | 'input';
  merge?: 'htp' | 'ltp';
  rdm?: boolean;
  outputStyle?: 'delta' | 'continuous';
  protocol?: 'artnet' | 'sacn';
  clearOutput?: true;
}

/** Arguments of `artAddress` (all optional except `nodeId`). */
export interface ArtAddressArgs {
  nodeId: NodeId;
  shortName?: string;
  longName?: string;
  ports?: ArtAddressPortChange[];
  failsafe?: 'hold' | 'zero' | 'full' | 'scene';
  recordFailsafeScene?: true;
  indicator?: 'normal' | 'mute' | 'locate';
  cancelMerge?: true;
  resetRxFlags?: true;
}

/** Arguments of `ipProg`. */
export interface IpProgArgs {
  nodeId: NodeId;
  dhcp?: boolean;
  ip?: string;
  mask?: string;
  gateway?: string;
  resetToDefault?: boolean;
}

/** Empty result / no arguments. */
export type Empty = Record<string, never>;

/** Every command with its arguments (without `type`/`id`) and result. */
export interface BridgeCommandMap {
  hello: { args: { client: string; clientVersion: string; protocol: string }; result: Empty };
  nodes: { args: Empty; result: { nodes: NodeState[]; tods: Tod[] } };
  poll: { args: Empty; result: Empty };
  addPollTarget: { args: { ip: string }; result: Empty };
  removePollTarget: { args: { ip: string }; result: Empty };
  todRequest: { args: { nodeId: NodeId; port: PortRef }; result: Empty };
  todControl: { args: { nodeId: NodeId; port: PortRef; action: TodControlAction }; result: Empty };
  rdmGet: { args: RdmGetArgs; result: RdmResult };
  rdmSet: { args: RdmSetArgs; result: RdmResult };
  rdmDescribe: { args: RdmAddress & { refresh?: boolean }; result: RdmDeviceDescription };
  artAddress: { args: ArtAddressArgs; result: { node: NodeState } };
  ipProg: { args: IpProgArgs; result: { ip: string; mask: string; gateway: string; dhcp: boolean } };
  artInput: { args: { nodeId: NodeId; bind: number; disabled: boolean[] }; result: { node: NodeState } };
  imageInfo: { args: { hex: string }; result: FirmwareImageInfo };
  flash: { args: RdmAddress & { hex: string; allowDowngrade: boolean }; result: { job: FlashJob } };
  flashCancel: { args: { jobId: string }; result: Empty };
  flashJobs: { args: Empty; result: { jobs: FlashJob[] } };
  dmxRoutes: { args: { routes: DmxRoute[] }; result: Empty };
}

/** Name of any command. */
export type BridgeCommandType = keyof BridgeCommandMap;

/**
 * Commands callers use through `ArtNetBackend.request`. `hello`,
 * `dmxRoutes` and the poll-target commands are driven by the backend itself
 * (handshake, `sendDmx`, `addPollTarget`).
 */
export type PublicCommandType = Exclude<BridgeCommandType, 'hello' | 'dmxRoutes' | 'addPollTarget' | 'removePollTarget'>;

/** Arguments of a command. */
export type CommandArgs<C extends BridgeCommandType> = BridgeCommandMap[C]['args'];

/** Result of a command. */
export type CommandResult<C extends BridgeCommandType> = BridgeCommandMap[C]['result'];

// ── Replies (bridge → app) ─────────────────────

/** Successful answer to a command. */
export interface ResultMessage {
  type: 'result';
  id: number;
  result: Record<string, unknown>;
}

/** Error codes sent by the bridge (§8). */
export type BridgeErrorCode =
  | 'badRequest'
  | 'unknownCommand'
  | 'helloRequired'
  | 'incompatibleProtocol'
  | 'unknownNode'
  | 'unknownPort'
  | 'timeout'
  | 'nack'
  | 'badResponse'
  | 'invalidPortAddress'
  | 'invalidImage'
  | 'deviceMismatch'
  | 'downgrade'
  | 'busy'
  | 'unknownJob'
  | 'udpUnavailable'
  | 'internal';

/** Error codes produced by the app-side client. */
export type ClientErrorCode = 'notConnected' | 'disconnected' | 'requestTimeout';

/** Any error code a command promise can reject with. */
export type ErrorCode = BridgeErrorCode | ClientErrorCode;

/** Failed answer to a command (`id: null` = not attributable). */
export interface ErrorMessage {
  type: 'error';
  id: number | null;
  code: BridgeErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/** Everything the bridge may send as text. */
export type BridgeMessage = HelloEvent | ResultMessage | ErrorMessage | BridgeEvent;

// ── Version rule ───────────────────────────────

/** Semver major of a version string; null when unparsable. */
export function semverMajor(version: string): number | null {
  const m = /^(\d+)\.\d+\.\d+/.exec(version);
  return m ? Number(m[1]) : null;
}

/**
 * Compares the bridge's protocol with ours (§1 Versioning): same major =
 * compatible; otherwise who has to update.
 */
export function checkProtocol(bridgeProtocol: string, appProtocol: string = PROTOCOL_VERSION): 'ok' | 'bridgeTooOld' | 'appTooOld' {
  const bridge = semverMajor(bridgeProtocol);
  const app = semverMajor(appProtocol);
  if (bridge === null || app === null) return 'bridgeTooOld';
  if (bridge === app) return 'ok';
  return bridge < app ? 'bridgeTooOld' : 'appTooOld';
}

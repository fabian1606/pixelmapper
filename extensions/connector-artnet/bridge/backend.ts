/**
 * `ArtNetBackend` — the seam between the plugin and whatever speaks Art-Net
 * for it.
 *
 * UI and connectors only use this interface. The implementation is
 * `WsBridgeBackend`, which speaks the bridge contract over a `BridgeTransport`:
 * a WebSocket to `pmnet-bridge serve` (browser) or the bridge embedded in the
 * desktop app (`Platform.artnetBridge`), so platform details never leak into
 * components or connectors. Commands
 * and events mirror the WebSocket contract 1:1
 * (`architecture/artnet-bridge-ws-protocol.md`).
 */
import type { Ref } from 'vue';
import type { NetInterface, NodeId, UdpState } from './protocol-model';
import type {
  BridgeEventMap,
  BridgeEventType,
  CommandArgs,
  CommandResult,
  ErrorCode,
  PublicCommandType,
} from './protocol-messages';

/** What the backend reported in its handshake. */
export interface BackendInfo {
  /** Bridge (pmnet-bridge) version. */
  bridgeVersion: string;
  /** Protocol version of the bridge. */
  protocol: string;
  interfaces: NetInterface[];
  udp: UdpState;
}

/** Why a bridge cannot be used. */
export type IncompatibleReason = 'bridgeTooOld' | 'appTooOld' | 'noHello';

/** Connection state of a backend. */
export type BackendState =
  | { kind: 'idle' }
  /** The platform cannot reach a bridge (Safari). */
  | { kind: 'unsupported'; reason: string }
  | { kind: 'connecting'; url: string }
  | { kind: 'connected'; url: string; info: BackendInfo }
  /**
   * Not reachable; retrying after `retryInMs`. `error` is the transport's
   * reason when it gave one (e.g. why the built-in bridge could not start).
   */
  | { kind: 'unreachable'; url: string; attempts: number; retryInMs: number; error?: string }
  /** Reachable but speaks another protocol version (or none); retrying slowly. */
  | { kind: 'incompatible'; url: string; reason: IncompatibleReason; bridgeVersion: string | null; protocol: string | null };

/** Destination of DMX: a node port-address (unicast to the node's IP) or a fixed IP. */
export type DmxTarget = { nodeId: NodeId; portAddress: number } | { ip: string; portAddress: number };

/** Options of a command. */
export interface RequestOptions {
  /** Client-side timeout; default 5 s (rdmDescribe/flash use longer defaults). */
  timeoutMs?: number;
}

/** A command failed (bridge error or client-side failure). */
export class BridgeCommandError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'BridgeCommandError';
    this.code = code;
    this.details = details;
  }

  /** NACK reason of an RDM NACK, else undefined. */
  get nackReason(): number | undefined {
    return typeof this.details.nackReason === 'number' ? this.details.nackReason : undefined;
  }
}

/** The plugin's access to Art-Net (see file comment). */
export interface ArtNetBackend {
  /** Connection state (reactive). */
  readonly state: Readonly<Ref<BackendState>>;
  /**
   * Why the bridge rejected the last DMX route table (it then keeps the
   * previous one, so new routes get no DMX), or null. Cleared when a table
   * is accepted or the connection is re-established (reactive).
   */
  readonly dmxError: Readonly<Ref<string | null>>;
  /** Starts connecting and keeps reconnecting with backoff (idempotent). */
  start(): void;
  /** Disconnects and stops reconnecting. */
  stop(): void;
  /** Skips the current backoff and connects now (Retry button). */
  reconnectNow(): void;
  /**
   * Sends a command. Rejects with `BridgeCommandError` (bridge error codes,
   * `notConnected`, `disconnected`, `requestTimeout`).
   */
  request<C extends PublicCommandType>(type: C, args: CommandArgs<C>, options?: RequestOptions): Promise<CommandResult<C>>;
  /** Subscribes to an event; returns the unsubscribe function. */
  on<E extends BridgeEventType>(type: E, listener: (event: BridgeEventMap[E]) => void): () => void;
  /**
   * Queues one universe for the current frame set. Everything queued in the
   * same task goes out as one frame set followed by ArtSync. Never blocks;
   * dropped while not connected or when the transport is backed up.
   */
  sendDmx(target: DmxTarget, data: Uint8Array): void;
  /**
   * Polls `ip` directly (manual add of nodes outside the broadcast domain)
   * until the returned function is called; survives reconnects.
   */
  addPollTarget(ip: string): () => void;
}

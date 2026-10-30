/**
 * `ArtNetBackend` over the bridge contract
 * (`architecture/artnet-bridge-ws-protocol.md`): to `pmnet-bridge serve` over
 * a WebSocket (browser) or to the bridge embedded in the desktop app. The
 * byte pipe is a `BridgeTransport` created per connect attempt
 * (`bridge-transport.ts`); everything protocol-related stays here.
 *
 * One instance per app (see `shared.ts`). Connects, checks the `hello`
 * version, reconnects with exponential backoff, correlates commands with
 * results, fans out events, keeps poll targets across reconnects and sends
 * DMX as one binary frame set per rendered frame. Builds no Art-Net packets.
 *
 * Results are correlated by `id` only: the bridge runs network commands
 * (RDM, TOD, ArtAddress, …) concurrently, so their replies may overtake each
 * other and later commands. Nothing here assumes in-order results.
 */
import { shallowRef, type ShallowRef } from 'vue';
import {
  BridgeCommandError,
  type ArtNetBackend,
  type BackendState,
  type DmxTarget,
  type IncompatibleReason,
  type RequestOptions,
} from './backend';
import {
  checkProtocol,
  PROTOCOL_VERSION,
  type BridgeCommandType,
  type BridgeEventMap,
  type BridgeEventType,
  type BridgeMessage,
  type CommandArgs,
  type CommandResult,
  type ErrorMessage,
  type HelloEvent,
  type PublicCommandType,
} from './protocol-messages';
import { DmxRouter } from './dmx-router';
import { encodeFrameSet } from './frame-set';
import { commandArgsProblem, dmxTargetProblem, MAX_MESSAGE_BYTES, utf8ByteLength } from './command-limits';
import type { NetInterface } from './protocol-model';
import type { BridgeTransport, BridgeTransportFactory } from './bridge-transport';
import { createWebSocketTransport, type WebSocketFactory } from './websocket-transport';

export type { WebSocketFactory } from './websocket-transport';

// ── Timing ─────────────────────────────────────

/** Transport must open within this time. */
const CONNECT_TIMEOUT_MS = 5000;
/** `hello` must arrive within this time after open (contract §1). */
const HELLO_TIMEOUT_MS = 3000;
/** First retry delay; doubles per failed attempt. */
const BACKOFF_INITIAL_MS = 1000;
/** Longest retry delay. */
const BACKOFF_MAX_MS = 30_000;
/** Retry delay after a version mismatch (the user has to update first). */
const INCOMPATIBLE_RETRY_MS = 30_000;
/** Default client-side command timeout. */
const DEFAULT_TIMEOUT_MS = 5000;
/** Longer defaults for slow commands. */
const COMMAND_TIMEOUT_MS: Partial<Record<BridgeCommandType, number>> = {
  rdmGet: 10_000,
  rdmSet: 10_000,
  rdmDescribe: 60_000,
  imageInfo: 10_000,
  flash: 30_000,
};
/** Frame sets are dropped while more than this is waiting in the transport. */
const MAX_BUFFERED_BYTES = 256 * 1024;

/** Close codes of the contract (§1) with the text logged when the bridge uses one. */
const CLOSE_REASONS: Readonly<Record<number, string>> = {
  4001: 'incompatible protocol',
  4002: 'no client hello within 10 s',
  4003: 'this app read the bridge\'s messages too slowly (its queue overflowed)',
  1001: 'the bridge is shutting down',
};

/** Options of `WsBridgeBackend`. */
export interface WsBridgeBackendOptions {
  /**
   * Bridge URL (WebSocket) or display label of the transport, read on every
   * connect attempt; shown as `BackendState.url`.
   */
  url: () => string;
  /** Version of this app (sent in the client `hello`). */
  clientVersion: string;
  /** Returns a reason when the platform cannot reach a bridge (Safari), else null. */
  unsupportedReason?: () => string | null;
  /** WebSocket implementation of the default transport; default `globalThis.WebSocket`. */
  WebSocketImpl?: WebSocketFactory;
  /** Creates the transport per connect attempt; default a WebSocket to `url()`. */
  transport?: BridgeTransportFactory;
}

/** An open command. */
interface Pending {
  resolve: (result: unknown) => void;
  reject: (error: BridgeCommandError) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class WsBridgeBackend implements ArtNetBackend {
  readonly state: ShallowRef<BackendState> = shallowRef<BackendState>({ kind: 'idle' });
  readonly dmxError: ShallowRef<string | null> = shallowRef<string | null>(null);

  private transport: BridgeTransport | null = null;
  /** Counts connect attempts; callbacks of older attempts are ignored. */
  private session = 0;
  /** Reason of the last close without a contract code (e.g. "bridge could not start"). */
  private lastCloseReason = '';
  private started = false;
  /** True once the client `hello` was answered. */
  private handshaken = false;
  private attempts = 0;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Map<BridgeEventType, Set<(event: never) => void>>();
  private pollTargets = new Map<string, number>();
  /** Interfaces of the bridge host (hello, bridgeStatus): broadcast check of DMX targets. */
  private interfaces: NetInterface[] = [];
  /** DMX targets already reported as invalid (logged once). */
  private refusedTargets = new Set<string>();
  private router = new DmxRouter(undefined, target => dmxTargetProblem(target, this.interfaces));
  private flushScheduled = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private helloTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: WsBridgeBackendOptions) {}

  // ── Lifecycle ────────────────────────────────

  start(): void {
    if (this.started) return;
    this.started = true;
    const reason = this.unsupportedReason();
    if (reason) {
      this.state.value = { kind: 'unsupported', reason };
      return;
    }
    this.openSocket(false);
  }

  stop(): void {
    this.started = false;
    this.clearReconnect();
    this.dropSocket();
    this.state.value = { kind: 'idle' };
  }

  reconnectNow(): void {
    if (!this.started) return this.start();
    if (this.state.value.kind === 'unsupported') return;
    this.clearReconnect();
    this.dropSocket();
    this.attempts = 0;
    this.openSocket(false);
  }

  /** Changes the bridge URL and reconnects when running. */
  setUrl(url: () => string): void {
    this.options.url = url;
    if (this.started) this.reconnectNow();
  }

  // ── Commands and events ──────────────────────

  request<C extends PublicCommandType>(type: C, args: CommandArgs<C>, options?: RequestOptions): Promise<CommandResult<C>> {
    // Fail early with the bridge's code for what it would reject anyway.
    const problem = commandArgsProblem(type, args);
    if (problem) return Promise.reject(new BridgeCommandError('badRequest', problem.message, { field: problem.field }));
    return this.send(type, args, options);
  }

  on<E extends BridgeEventType>(type: E, listener: (event: BridgeEventMap[E]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, set = new Set());
    set.add(listener as (event: never) => void);
    return () => { set!.delete(listener as (event: never) => void); };
  }

  addPollTarget(ip: string): () => void {
    const count = this.pollTargets.get(ip) ?? 0;
    this.pollTargets.set(ip, count + 1);
    if (count === 0 && this.handshaken) this.fireAndForget('addPollTarget', { ip });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.pollTargets.get(ip) ?? 1) - 1;
      if (left > 0) return void this.pollTargets.set(ip, left);
      this.pollTargets.delete(ip);
      if (this.handshaken) this.fireAndForget('removePollTarget', { ip });
    };
  }

  sendDmx(target: DmxTarget, data: Uint8Array): void {
    if (!this.handshaken) return;
    const refused = this.router.queue(target, data);
    if (refused) return this.reportRefusedTarget(target, refused);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => this.flush());
  }

  // ── Socket ───────────────────────────────────

  /** Opens a transport; `quiet` keeps the unreachable/incompatible state during retries. */
  private openSocket(quiet: boolean) {
    const url = this.options.url();
    if (!quiet) this.state.value = { kind: 'connecting', url };
    const session = ++this.session;
    const current = () => this.session === session;
    const factory = this.options.transport ?? createWebSocketTransport(this.options.WebSocketImpl);
    try {
      this.transport = factory(url, {
        onOpen: () => {
          if (!current()) return;
          this.clearTimer('connectTimer');
          this.helloTimer = setTimeout(() => this.onIncompatible('noHello', null, null), HELLO_TIMEOUT_MS);
        },
        onMessage: (text) => { if (current()) this.onMessage(text); },
        onClose: (code, reason) => {
          if (!current()) return;
          const known = CLOSE_REASONS[code];
          if (known) this.emitLog('warn', `The bridge closed the connection (${code}: ${known}); reconnecting`);
          else if (reason) this.emitLog('warn', `Connection to the bridge ended: ${reason}`);
          this.lastCloseReason = known ? '' : reason;
          this.onSocketDown();
        },
      });
    }
    catch (err) {
      this.lastCloseReason = (err as Error)?.message ?? '';
      return this.onSocketDown();
    }
    this.connectTimer = setTimeout(() => { if (current()) this.onSocketDown(); }, CONNECT_TIMEOUT_MS);
  }

  /**
   * Transport failed or closed: schedule the next attempt. (A version mismatch
   * goes through `onIncompatible`; a refused socket means no bridge runs.)
   */
  private onSocketDown() {
    const wasConnected = this.handshaken;
    this.dropSocket();
    if (!this.started) return;
    this.attempts = wasConnected ? 1 : this.attempts + 1;
    const delay = Math.min(BACKOFF_INITIAL_MS * 2 ** (this.attempts - 1), BACKOFF_MAX_MS);
    const error = this.lastCloseReason;
    this.lastCloseReason = '';
    this.state.value = { kind: 'unreachable', url: this.options.url(), attempts: this.attempts, retryInMs: delay, ...(error ? { error } : {}) };
    this.scheduleReconnect(delay);
  }

  /** Peer speaks another protocol: report and retry slowly. */
  private onIncompatible(reason: IncompatibleReason, bridgeVersion: string | null, protocol: string | null) {
    this.dropSocket();
    if (!this.started) return;
    this.state.value = { kind: 'incompatible', url: this.options.url(), reason, bridgeVersion, protocol };
    this.scheduleReconnect(INCOMPATIBLE_RETRY_MS);
  }

  /** Closes the transport and fails everything that depended on it. */
  private dropSocket() {
    this.clearTimer('connectTimer');
    this.clearTimer('helloTimer');
    const transport = this.transport;
    this.transport = null;
    this.session++;
    this.handshaken = false;
    this.router.clearPending();
    this.router.markDirty();
    if (transport) {
      try { transport.close(); }
      catch { /* already closed */ }
    }
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new BridgeCommandError('disconnected', 'Connection to the Art-Net bridge lost'));
      this.pending.delete(id);
    }
  }

  private scheduleReconnect(delay: number) {
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.started) return;
      const kind = this.state.value.kind;
      this.openSocket(kind === 'unreachable' || kind === 'incompatible');
    }, delay);
  }

  // ── Incoming ─────────────────────────────────

  private onMessage(data: string) {
    let msg: BridgeMessage;
    try {
      msg = JSON.parse(data) as BridgeMessage;
    }
    catch {
      return this.emitLog('warn', 'Malformed message from the bridge');
    }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'hello') return this.onHello(msg);
    if (msg.type === 'result') return this.settle(msg.id, p => p.resolve(msg.result ?? {}));
    if (msg.type === 'error') return this.onError(msg);
    if (msg.type === 'bridgeStatus' && Array.isArray(msg.interfaces)) this.interfaces = msg.interfaces;
    if (this.handshaken) this.emit(msg.type, msg);
  }

  /** Bridge `hello`: version check, then the client `hello`. */
  private onHello(hello: HelloEvent) {
    this.clearTimer('helloTimer');
    const verdict = checkProtocol(String(hello.protocol ?? ''));
    if (verdict !== 'ok') return this.onIncompatible(verdict, hello.bridge ?? null, hello.protocol ?? null);
    const session = this.session;
    this.interfaces = hello.interfaces ?? [];
    this.send('hello', { client: 'pixelmapper', clientVersion: this.options.clientVersion, protocol: PROTOCOL_VERSION }, {}, true)
      .then(() => {
        if (this.session !== session) return;
        this.handshaken = true;
        this.attempts = 0;
        this.dmxError.value = null;
        this.refusedTargets.clear();
        for (const ip of this.pollTargets.keys()) this.fireAndForget('addPollTarget', { ip });
        this.state.value = {
          kind: 'connected',
          url: this.options.url(),
          info: { bridgeVersion: hello.bridge, protocol: hello.protocol, interfaces: hello.interfaces ?? [], udp: hello.udp },
        };
      })
      .catch((e: BridgeCommandError) => {
        if (this.session !== session) return;
        if (e.code !== 'incompatibleProtocol') return this.onSocketDown();
        // `details.protocol` carries the bridge's version (contract §1); it says who must update.
        const theirs = typeof e.details.protocol === 'string' ? e.details.protocol : hello.protocol;
        const verdict = checkProtocol(String(theirs ?? ''));
        this.onIncompatible(verdict === 'bridgeTooOld' ? 'bridgeTooOld' : 'appTooOld', hello.bridge, theirs ?? null);
      });
  }

  private onError(msg: ErrorMessage) {
    const error = new BridgeCommandError(msg.code, msg.message ?? msg.code, msg.details ?? {});
    if (msg.id === null || msg.id === undefined) return this.emitLog('warn', `Bridge error: ${error.message}`);
    this.settle(msg.id, p => p.reject(error));
  }

  /** Resolves/rejects an open command. */
  private settle(id: number, fn: (p: Pending) => void) {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    fn(p);
  }

  private emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type as BridgeEventType) ?? []) {
      try {
        (listener as (e: unknown) => void)(event);
      }
      catch (err) {
        console.error(`[artnet] listener for "${type}" failed:`, err);
      }
    }
  }

  /** Client-side diagnostics as `log` events. */
  private emitLog(level: 'info' | 'warn' | 'error', text: string) {
    this.emit('log', { type: 'log', level, text: `[client] ${text}` });
  }

  // ── Outgoing ─────────────────────────────────

  /** Sends a command; `beforeHandshake` allows the client `hello`. */
  private send<C extends BridgeCommandType>(type: C, args: CommandArgs<C>, options: RequestOptions = {}, beforeHandshake = false): Promise<CommandResult<C>> {
    const transport = this.transport;
    if (!transport || !transport.isOpen || (!this.handshaken && !beforeHandshake)) {
      return Promise.reject(new BridgeCommandError('notConnected', 'The Art-Net bridge is not connected'));
    }
    const id = this.nextId++;
    const text = JSON.stringify({ ...args, type, id });
    // The bridge ends connections that send more than 4 MiB (contract §1).
    if (text.length * 3 > MAX_MESSAGE_BYTES && utf8ByteLength(text) > MAX_MESSAGE_BYTES) {
      return Promise.reject(new BridgeCommandError('badRequest', `"${type}" is larger than 4 MiB`));
    }
    const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS[type] ?? DEFAULT_TIMEOUT_MS;
    return new Promise<CommandResult<C>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeCommandError('requestTimeout', `No answer to "${type}" from the bridge`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (r: unknown) => void, reject, timer });
      try {
        transport.sendText(text);
      }
      catch (err) {
        this.settle(id, p => p.reject(new BridgeCommandError('disconnected', (err as Error).message ?? 'send failed')));
      }
    });
  }

  /** Sends a command whose result nobody waits for; failures become `log` events. */
  private fireAndForget<C extends BridgeCommandType>(type: C, args: CommandArgs<C>) {
    this.send(type, args).catch((e: BridgeCommandError) => {
      if (e.code !== 'disconnected' && e.code !== 'notConnected') this.emitLog('warn', `${type} failed: ${e.message}`);
    });
  }

  /** Sends the queued universes of this task as one frame set. */
  private flush() {
    this.flushScheduled = false;
    const transport = this.transport;
    if (!transport || !this.handshaken) return this.router.clearPending();
    const { routes, entries } = this.router.take();
    if (routes) this.sendRoutes(routes);
    if (!entries.length || transport.bufferedAmount > MAX_BUFFERED_BYTES) return;
    try {
      transport.sendBinary(encodeFrameSet(entries, true));
    }
    catch { /* the close handler takes over */ }
  }

  /**
   * Sends the route table. The bridge accepts it all or nothing (an invalid
   * table is rejected and the old one stays), so a rejection is kept in
   * `dmxError` for the connectors' status instead of being retried per frame.
   */
  private sendRoutes(routes: CommandArgs<'dmxRoutes'>['routes']) {
    this.send('dmxRoutes', { routes })
      .then(() => { this.dmxError.value = null; })
      .catch((e: BridgeCommandError) => {
        if (e.code === 'disconnected' || e.code === 'notConnected') return;
        this.dmxError.value = e.message;
        this.emitLog('error', `DMX routes rejected: ${e.message}`);
      });
  }

  /** Logs a DMX target the bridge would reject (once per target and connection). */
  private reportRefusedTarget(target: DmxTarget, problem: string) {
    const key = JSON.stringify(target);
    if (this.refusedTargets.has(key)) return;
    this.refusedTargets.add(key);
    this.emitLog('warn', `DMX not sent: ${problem}`);
  }

  // ── Helpers ──────────────────────────────────

  private unsupportedReason(): string | null {
    const usesGlobalWebSocket = !this.options.transport && !this.options.WebSocketImpl;
    if (usesGlobalWebSocket && typeof globalThis.WebSocket === 'undefined') return 'WebSocket is not available';
    return this.options.unsupportedReason?.() ?? null;
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearTimer(name: 'connectTimer' | 'helloTimer') {
    const t = this[name];
    if (t) clearTimeout(t);
    this[name] = null;
  }
}

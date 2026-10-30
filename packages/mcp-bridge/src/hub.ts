// ── Hub: WebSocket server on 127.0.0.1:7778 ─────────────
//
// The first `pixelmapper-mcp` process owns the port. It accepts exactly one
// active `app` connection (latest wins) plus any number of `relay`
// connections (other CLI processes) and routes tool calls to the app.
// Built on `node:http` + `ws` so it runs identically under Bun and under
// Vitest (Node).

import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { RawData } from 'ws';

import { ChangeEmitter } from './backend';
import type { BackendState, CallRequest, ToolBackend } from './backend';
import { isOriginAllowed } from './config';
import type { BridgeConfig } from './config';
import { logInfo, logWarn } from './log';
import {
  BRIDGE_VERSION,
  BridgeError,
  CLOSE_CODES,
  MAX_FRAME_BYTES,
  NO_APP_MESSAGE,
  PROTOCOL_VERSION,
  isCompatibleProtocol,
  parseFrame,
  sanitizeContent,
  sanitizeTools,
  toErrorCode,
} from './protocol';
import type { AppInfo, ClientInfo, ClientRole, ErrorCode, Frame, ToolCallOutcome, ToolDefinition } from './protocol';
import { tokensEqual } from './token';

/** Per-socket state. */
interface Connection {
  ws: WebSocket;
  origin: string | undefined;
  sessionId: string;
  role?: ClientRole;
  authed: boolean;
  helloTimer?: ReturnType<typeof setTimeout>;
  /** App only: announced tools and metadata. */
  tools: ToolDefinition[];
  app?: AppInfo;
  /** Relay only: MCP client info and relay-call-id → hub-call-id map. */
  client?: ClientInfo;
  relayCalls: Map<string | number, number>;
  /** Set when the socket sent a frame above {@link MAX_FRAME_BYTES}. */
  oversize?: boolean;
}

/** A call waiting for the app's `result` / `error`. */
interface PendingCall {
  resolve: (outcome: ToolCallOutcome) => void;
  reject: (error: BridgeError) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** The port-owning bridge process. */
export class Hub implements ToolBackend {
  private readonly wss: WebSocketServer;
  private readonly emitter = new ChangeEmitter();
  private readonly connections = new Set<Connection>();
  private readonly pending = new Map<number, PendingCall>();
  private app: Connection | null = null;
  private nextCallId = 1;
  private closed = false;

  private constructor(
    private readonly config: BridgeConfig,
    private readonly token: string,
    private readonly http: HttpServer,
  ) {
    this.wss = new WebSocketServer({
      server: http,
      maxPayload: MAX_FRAME_BYTES,
      // Browsers always send Origin. Reject foreign origins before the upgrade;
      // requests without Origin (CLI relays) may only authenticate as relay.
      verifyClient: (info, done) => {
        const origin = info.origin || undefined;
        if (origin && !isOriginAllowed(this.config, origin)) {
          logWarn(`rejected WebSocket upgrade from origin ${origin}`);
          done(false, 403, 'Origin not allowed');
          return;
        }
        done(true);
      },
    });
    this.wss.on('connection', (ws, req) => this.accept(ws, req.headers.origin));
    this.wss.on('error', (error) => logWarn('WebSocket server error', error));
  }

  /**
   * Binds the port and returns a running hub. Rejects with the listen error
   * (`code === 'EADDRINUSE'` when another process owns the port).
   */
  static async start(config: BridgeConfig, token: string): Promise<Hub> {
    const http = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('pixelmapper-mcp hub — connect via WebSocket\n');
    });
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(config.port, config.host, () => {
        http.off('error', reject);
        resolve();
      });
    });
    const hub = new Hub(config, token, http);
    logInfo(`hub listening on ws://${config.host}:${hub.port}`);
    return hub;
  }

  /** The actually bound port (differs from config when config.port is 0). */
  get port(): number {
    return (this.http.address() as AddressInfo).port;
  }

  // ── ToolBackend ─────────────────────────────────────────

  getState(): BackendState {
    return {
      mode: 'hub',
      appConnected: !!this.app,
      tools: this.app?.tools ?? [],
      app: this.app?.app,
    };
  }

  call(request: CallRequest): Promise<ToolCallOutcome> {
    return this.dispatch(request).promise;
  }

  onChange(listener: () => void): () => void {
    return this.emitter.on(listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failPending('app_disconnected', 'Bridge is shutting down');
    for (const conn of this.connections) conn.ws.close(CLOSE_CODES.goingAway, 'hub shutting down');
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    // Force-close lingering sockets so `http.close` can finish.
    for (const conn of this.connections) conn.ws.terminate();
    this.http.closeAllConnections?.();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  // ── Connection lifecycle ────────────────────────────────

  /** Registers a new socket, sends the hub `hello` and arms the hello timeout. */
  private accept(ws: WebSocket, origin: string | undefined): void {
    const conn: Connection = {
      ws,
      origin,
      sessionId: randomBytes(4).toString('hex'),
      authed: false,
      tools: [],
      relayCalls: new Map(),
    };
    this.connections.add(conn);
    conn.helloTimer = setTimeout(() => {
      this.reject(conn, 'bad_hello', 'No hello received within timeout', CLOSE_CODES.helloTimeout);
    }, this.config.helloTimeoutMs);
    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) return this.reject(conn, 'bad_message', 'Binary frames are not supported', CLOSE_CODES.badHello);
      this.handle(conn, data.toString());
    });
    ws.on('close', () => this.dropped(conn));
    ws.on('error', (error: Error & { code?: string }) => {
      // `ws` closes the socket after an oversize frame; remember why so
      // pending calls fail with a clear message instead of "disconnected".
      if (error.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH') conn.oversize = true;
      logWarn('socket error', error);
    });
    send(ws, { type: 'hello', role: 'hub', bridge: BRIDGE_VERSION, protocol: PROTOCOL_VERSION });
  }

  /** Sends an `error` and closes the socket (handshake failures). */
  private reject(conn: Connection, code: ErrorCode, message: string, closeCode: number): void {
    clearTimeout(conn.helloTimer);
    send(conn.ws, { type: 'error', code, message });
    conn.ws.close(closeCode, code);
  }

  /** Cleans up after a socket closed. */
  private dropped(conn: Connection): void {
    clearTimeout(conn.helloTimer);
    this.connections.delete(conn);
    if (conn === this.app) {
      this.app = null;
      logInfo('app disconnected');
      this.failPending(
        'app_disconnected',
        conn.oversize
          ? `Tool result exceeded the bridge frame limit (${MAX_FRAME_BYTES} bytes) and was dropped; narrow the request (fewer entities, detail "summary").`
          : 'Pixelmapper disconnected while the call was running',
      );
      this.announce();
    } else if (conn.role === 'relay') {
      // Cancel the relay's in-flight calls in the app.
      for (const hubId of conn.relayCalls.values()) this.cancel(hubId, 'relay disconnected');
      logInfo(`relay ${conn.client?.name ?? '?'} disconnected`);
    }
  }

  // ── Inbound frames ──────────────────────────────────────

  /** Routes one text frame by connection state and role. */
  private handle(conn: Connection, raw: string): void {
    const frame = parseFrame(raw);
    if (!conn.authed) {
      if (frame?.type !== 'hello') {
        this.reject(conn, 'bad_message', 'Expected hello', CLOSE_CODES.badHello);
        return;
      }
      this.handleHello(conn, frame);
      return;
    }
    if (!frame) {
      send(conn.ws, { type: 'error', code: 'bad_message', message: 'Frame is not a JSON object with "type"' });
      return;
    }
    if (frame.type === 'ping') {
      send(conn.ws, { type: 'pong', id: frame.id });
      return;
    }
    if (frame.type === 'pong') return;
    if (!conn.role) return; // superseded app, still draining before close
    if (conn.role === 'app') this.handleAppFrame(conn, frame);
    else this.handleRelayFrame(conn, frame);
  }

  /** Validates a client hello (role, protocol, token, origin) and admits the client. */
  private handleHello(conn: Connection, hello: Frame): void {
    const role = hello.role;
    if (role !== 'app' && role !== 'relay') {
      return this.reject(conn, 'bad_hello', 'hello.role must be "app" or "relay"', CLOSE_CODES.badHello);
    }
    if (!isCompatibleProtocol(hello.protocol)) {
      return this.reject(
        conn,
        'protocol_mismatch',
        `Protocol ${String(hello.protocol)} is incompatible with ${PROTOCOL_VERSION}`,
        CLOSE_CODES.protocolMismatch,
      );
    }
    if (!tokensEqual(this.token, hello.token)) {
      logWarn(`rejected ${role} hello: wrong pairing token`);
      return this.reject(conn, 'unauthorized', 'Pairing token missing or wrong', CLOSE_CODES.unauthorized);
    }
    if (role === 'app' && !isOriginAllowed(this.config, conn.origin)) {
      logWarn(`rejected app hello: origin ${conn.origin ?? '(none)'} not allowed`);
      return this.reject(conn, 'origin_rejected', 'Origin not allowed for role "app"', CLOSE_CODES.unauthorized);
    }
    clearTimeout(conn.helloTimer);
    conn.authed = true;
    conn.role = role;
    if (role === 'app') this.admitApp(conn, hello);
    else this.admitRelay(conn, hello);
  }

  /** Makes `conn` the active app, superseding any previous one. */
  private admitApp(conn: Connection, hello: Frame): void {
    conn.tools = sanitizeTools(hello.tools, (reason) => logWarn(`app tool dropped: ${reason}`));
    conn.app = typeof hello.app === 'object' && hello.app ? (hello.app as AppInfo) : undefined;
    const previous = this.app;
    this.app = conn;
    if (previous) {
      // Detach first so its close handler does not clear the new app.
      previous.role = undefined;
      send(previous.ws, { type: 'superseded', message: 'Another Pixelmapper window connected to the MCP bridge' });
      previous.ws.close(CLOSE_CODES.superseded, 'superseded');
      this.failPending('app_disconnected', 'Pixelmapper window was replaced while the call was running');
    }
    send(conn.ws, {
      type: 'welcome',
      role: 'app',
      sessionId: conn.sessionId,
      callTimeoutMs: this.config.callTimeoutMs,
    });
    logInfo(`app connected (${conn.app?.name ?? 'app'} ${conn.app?.version ?? ''}, ${conn.tools.length} tools)`);
    this.announce();
  }

  /** Admits a relay and sends it the current tool state. */
  private admitRelay(conn: Connection, hello: Frame): void {
    const client = hello.client as ClientInfo | undefined;
    conn.client = client && typeof client.name === 'string' ? client : undefined;
    send(conn.ws, {
      type: 'welcome',
      role: 'relay',
      sessionId: conn.sessionId,
      callTimeoutMs: this.config.callTimeoutMs,
      appConnected: !!this.app,
      tools: this.app?.tools ?? [],
    });
    logInfo(`relay connected (${conn.client?.name ?? 'unknown client'})`);
  }

  /** Handles `tools`, `result` and `error` from the active app. */
  private handleAppFrame(conn: Connection, frame: Frame): void {
    switch (frame.type) {
      case 'tools':
        conn.tools = sanitizeTools(frame.tools, (reason) => logWarn(`app tool dropped: ${reason}`));
        logInfo(`app re-announced ${conn.tools.length} tools`);
        this.announce();
        return;
      case 'result':
      case 'error': {
        const call = this.pending.get(frame.id as number);
        if (!call) return; // late answer after timeout/cancel
        this.pending.delete(frame.id as number);
        clearTimeout(call.timer);
        if (frame.type === 'result') {
          call.resolve({ content: sanitizeContent(frame.content), isError: frame.isError === true });
        } else {
          call.reject(new BridgeError(toErrorCode(frame.code), String(frame.message ?? 'Tool failed')));
        }
        return;
      }
      default:
        send(conn.ws, { type: 'error', code: 'bad_message', message: `Unknown message type "${frame.type}"` });
    }
  }

  /** Handles `call` and `cancel` from a relay. */
  private handleRelayFrame(conn: Connection, frame: Frame): void {
    const relayId = frame.id as string | number;
    if (frame.type === 'cancel') {
      const hubId = conn.relayCalls.get(relayId);
      if (hubId !== undefined) this.cancel(hubId, 'cancelled by client');
      return;
    }
    if (frame.type !== 'call' || typeof frame.tool !== 'string') {
      send(conn.ws, { type: 'error', id: relayId, code: 'bad_message', message: `Unexpected "${frame.type}"` });
      return;
    }
    const { id: hubId, promise } = this.dispatch({
      tool: frame.tool,
      input: isRecord(frame.input) ? frame.input : {},
      client: typeof frame.client === 'string' ? frame.client : (conn.client?.name ?? 'unknown'),
    });
    if (hubId !== undefined) conn.relayCalls.set(relayId, hubId);
    promise
      .then((outcome) => send(conn.ws, { type: 'result', id: relayId, ...outcome }))
      .catch((error: BridgeError) =>
        send(conn.ws, { type: 'error', id: relayId, code: error.code, message: error.message }),
      )
      .finally(() => conn.relayCalls.delete(relayId));
  }

  // ── Call routing ────────────────────────────────────────

  /** Sends a `call` to the app and tracks it until answer, timeout or abort. */
  private dispatch(request: CallRequest): { id?: number; promise: Promise<ToolCallOutcome> } {
    const app = this.app;
    if (!app) return { promise: Promise.reject(new BridgeError('no_app', NO_APP_MESSAGE)) };
    const id = this.nextCallId++;
    const promise = new Promise<ToolCallOutcome>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.cancel(id, 'timeout');
        reject(new BridgeError('timeout', `Tool "${request.tool}" did not answer within ${this.config.callTimeoutMs} ms`));
      }, this.config.callTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      request.signal?.addEventListener('abort', () => {
        if (!this.pending.has(id)) return;
        this.cancel(id, 'cancelled by client');
        reject(new BridgeError('tool_failed', 'Call cancelled by the MCP client'));
      });
    });
    send(app.ws, { type: 'call', id, tool: request.tool, input: request.input, client: request.client });
    return { id, promise };
  }

  /** Drops a pending call and tells the app to abort it. */
  private cancel(id: number, reason: string): void {
    const call = this.pending.get(id);
    if (!call) return;
    clearTimeout(call.timer);
    this.pending.delete(id);
    if (this.app) send(this.app.ws, { type: 'cancel', id, reason });
  }

  /** Rejects every in-flight call (app gone / replaced / shutdown). */
  private failPending(code: ErrorCode, message: string): void {
    for (const [id, call] of this.pending) {
      clearTimeout(call.timer);
      call.reject(new BridgeError(code, message));
      this.pending.delete(id);
    }
  }

  /** Notifies local listeners and all relays about a tool/app state change. */
  private announce(): void {
    this.emitter.emit();
    const frame = { type: 'tools', tools: this.app?.tools ?? [], appConnected: !!this.app };
    for (const conn of this.connections) {
      if (conn.authed && conn.role === 'relay') send(conn.ws, frame);
    }
  }
}

// ── Helpers ─────────────────────────────────────────────

/** Sends a JSON frame if the socket is open. */
export function send(ws: WebSocket, frame: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
}

/** True for plain (non-array) objects. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

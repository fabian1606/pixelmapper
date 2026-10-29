// ── Relay client ────────────────────────────────────────
//
// Used by a second `pixelmapper-mcp` process when the hub port is already
// taken: it connects to the hub as `role: "relay"` and forwards its MCP
// client's tool calls through the hub to the app.

import { WebSocket } from 'ws';

import { ChangeEmitter } from './backend';
import type { BackendState, CallRequest, ToolBackend } from './backend';
import type { BridgeConfig } from './config';
import { send } from './hub';
import { logInfo } from './log';
import {
  BridgeError,
  PROTOCOL_VERSION,
  isCompatibleProtocol,
  parseFrame,
  sanitizeContent,
  sanitizeTools,
  toErrorCode,
} from './protocol';
import type { ClientInfo, Frame, ToolCallOutcome, ToolDefinition } from './protocol';

/** Extra time a relay waits beyond the hub's own call timeout. */
const RELAY_TIMEOUT_MARGIN_MS = 5_000;

/** A relay call waiting for the hub's answer. */
interface PendingRelayCall {
  resolve: (outcome: ToolCallOutcome) => void;
  reject: (error: BridgeError) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Connection from a secondary CLI process to the hub. */
export class RelayClient implements ToolBackend {
  private readonly emitter = new ChangeEmitter();
  private readonly pending = new Map<number, PendingRelayCall>();
  private readonly closedListeners = new Set<() => void>();
  private tools: ToolDefinition[] = [];
  private appConnected = false;
  private nextId = 1;
  private isClosed = false;

  private constructor(
    private readonly ws: WebSocket,
    private readonly callTimeoutMs: number,
  ) {
    ws.on('message', (data) => this.handle(parseFrame(data.toString())));
    ws.on('close', () => this.onSocketClosed());
    ws.on('error', () => {}); // close follows; avoid unhandled 'error'
  }

  /**
   * Connects and authenticates against the hub at `config.port`. Rejects
   * with a `BridgeError` (handshake refused) or the socket error
   * (`ECONNREFUSED` when no hub is listening).
   */
  static connect(config: BridgeConfig, token: string, client: ClientInfo): Promise<RelayClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${config.host}:${config.port}`);
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ws.terminate();
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error('hub handshake timed out')), config.helloTimeoutMs);
      ws.on('error', fail);
      ws.on('close', () => fail(new Error('hub closed the connection during handshake')));
      ws.on('message', (data) => {
        if (settled) return;
        const frame = parseFrame(data.toString());
        if (frame?.type === 'hello') {
          if (!isCompatibleProtocol(frame.protocol)) {
            fail(new BridgeError('protocol_mismatch', `Hub speaks protocol ${String(frame.protocol)}`));
            return;
          }
          send(ws, { type: 'hello', role: 'relay', protocol: PROTOCOL_VERSION, token, client });
        } else if (frame?.type === 'welcome') {
          settled = true;
          clearTimeout(timer);
          ws.removeAllListeners();
          const relay = new RelayClient(ws, config.callTimeoutMs);
          relay.applyTools(frame);
          logInfo(`connected to hub as relay (app ${relay.appConnected ? 'connected' : 'not connected'})`);
          resolve(relay);
        } else if (frame?.type === 'error') {
          fail(new BridgeError(toErrorCode(frame.code), String(frame.message ?? 'hub rejected relay')));
        }
      });
    });
  }

  /** Registers a callback for when the hub connection is lost. */
  onClosed(listener: () => void): void {
    this.closedListeners.add(listener);
  }

  // ── ToolBackend ─────────────────────────────────────────

  getState(): BackendState {
    return { mode: 'relay', appConnected: this.appConnected, tools: this.tools };
  }

  call(request: CallRequest): Promise<ToolCallOutcome> {
    if (this.isClosed) return Promise.reject(new BridgeError('app_disconnected', 'Lost connection to the bridge hub'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        send(this.ws, { type: 'cancel', id });
        reject(new BridgeError('timeout', `Tool "${request.tool}" did not answer in time`));
      }, this.callTimeoutMs + RELAY_TIMEOUT_MARGIN_MS);
      this.pending.set(id, { resolve, reject, timer });
      request.signal?.addEventListener('abort', () => {
        if (!this.pending.has(id)) return;
        clearTimeout(timer);
        this.pending.delete(id);
        send(this.ws, { type: 'cancel', id });
        reject(new BridgeError('tool_failed', 'Call cancelled by the MCP client'));
      });
      send(this.ws, { type: 'call', id, tool: request.tool, input: request.input, client: request.client });
    });
  }

  onChange(listener: () => void): () => void {
    return this.emitter.on(listener);
  }

  async close(): Promise<void> {
    this.closedListeners.clear();
    this.ws.close(1000, 'relay closing');
  }

  // ── Internals ───────────────────────────────────────────

  /** Applies `tools` / `appConnected` from a `welcome` or `tools` frame. */
  private applyTools(frame: Frame): void {
    this.tools = sanitizeTools(frame.tools);
    this.appConnected = frame.appConnected === true;
  }

  /** Handles frames from the hub after the handshake. */
  private handle(frame: Frame | null): void {
    if (!frame) return;
    switch (frame.type) {
      case 'tools':
        this.applyTools(frame);
        this.emitter.emit();
        return;
      case 'ping':
        send(this.ws, { type: 'pong', id: frame.id });
        return;
      case 'result':
      case 'error': {
        const call = this.pending.get(frame.id as number);
        if (!call) return;
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
      // Unknown types are ignored for forward compatibility (minor bumps).
    }
  }

  /** Fails in-flight calls and notifies the coordinator (takeover). */
  private onSocketClosed(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.appConnected = false;
    for (const [id, call] of this.pending) {
      clearTimeout(call.timer);
      call.reject(new BridgeError('app_disconnected', 'Lost connection to the bridge hub'));
      this.pending.delete(id);
    }
    this.emitter.emit();
    for (const listener of this.closedListeners) listener();
  }
}

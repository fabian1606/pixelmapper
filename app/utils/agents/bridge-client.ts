/**
 * App-side WebSocket client of `pixelmapper-mcp` (plan M3). Speaks the
 * protocol in `architecture/mcp-bridge-protocol.md`: answers the hub
 * `hello`, announces the tools, runs `call`s, honours `cancel`, and
 * reconnects with backoff except after 4001/4002/4003.
 *
 * Host-agnostic and Vue-free: the WebSocket constructor, host and tools are
 * injected so tests can drive it with `ws` against a real hub.
 */
import type { AgentHost } from '@pixelmapper/agent-kit';
import { toolDescriptor } from '@pixelmapper/agent-kit';
import { CLOSE_CODES, PROTOCOL_VERSION, isCompatibleProtocol, parseFrame } from '~~/packages/mcp-bridge/src/protocol';
import type { Frame } from '~~/packages/mcp-bridge/src/protocol';
import { CallRunner } from './bridge-calls';
import { BridgeStatusEmitter, bridgeStatus } from './bridge-status';
import type { BridgeStatus } from './bridge-status';
import { DEFAULT_BACKOFF_MS, DEFAULT_BRIDGE_URL } from './bridge-client-types';
import type { BridgeClient, BridgeClientOptions, BridgeSocket, BridgeSocketCtor } from './bridge-client-types';

// Types live in `bridge-client-types.ts`; re-exported for callers.
export * from './bridge-client-types';

/** WebSocket `OPEN` ready state. */
const OPEN = 1;

// ── Client ──────────────────────────────────────

/** Creates a bridge client; call `start()` to connect. */
export function createBridgeClient(options: BridgeClientOptions): BridgeClient {
  const url = options.url ?? DEFAULT_BRIDGE_URL;
  const backoff = options.backoffMs?.length ? options.backoffMs : DEFAULT_BACKOFF_MS;
  const Socket = options.WebSocketImpl ?? (globalThis.WebSocket as unknown as BridgeSocketCtor);
  const status = new BridgeStatusEmitter();
  const getHost = typeof options.host === 'function' ? options.host : () => options.host as AgentHost;

  let running = false;
  let socket: BridgeSocket | null = null;
  let welcomed = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Terminal state set by a frame before the close event arrives. */
  let terminal: BridgeStatus | null = null;
  let lastError: string | undefined;

  /** Sends a frame on the current socket if it is open. */
  const send = (frame: Record<string, unknown>) => {
    if (socket && socket.readyState === OPEN) socket.send(JSON.stringify(frame));
  };

  const calls = new CallRunner({
    tools: options.tools,
    host: getHost,
    send,
    onClient: (client) => {
      if (status.get().lastClient !== client) status.patch({ lastClient: client });
    },
  });

  /** Wire descriptors of the current tools. */
  const descriptors = () => options.tools().map(toolDescriptor);

  /** Opens a new socket (one at a time). */
  function connect(): void {
    retryTimer = null;
    if (!running) return;
    if (!options.token) {
      running = false;
      status.set(bridgeStatus('unauthorized', { message: 'No pairing token set' }));
      return;
    }
    welcomed = false;
    terminal = null;
    if (status.get().state !== 'waiting') status.set(bridgeStatus('connecting', { lastError }));
    let ws: BridgeSocket;
    try {
      ws = new Socket(url);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      scheduleRetry();
      return;
    }
    socket = ws;
    ws.onmessage = (event) => {
      if (socket === ws) handleFrame(ws, parseFrame(event.data));
    };
    ws.onerror = () => {
      // The close event follows; nothing to do here (browsers hide details).
    };
    ws.onclose = (event) => {
      if (socket === ws) handleClose(event.code);
    };
  }

  /** Dispatches one inbound frame. */
  function handleFrame(ws: BridgeSocket, frame: Frame | null): void {
    if (!frame) return;
    switch (frame.type) {
      case 'hello':
        if (!isCompatibleProtocol(frame.protocol)) {
          terminal = bridgeStatus('incompatible', { lastError: `Hub protocol ${String(frame.protocol)}` });
          ws.close(1000, 'protocol mismatch');
          return;
        }
        send({
          type: 'hello',
          role: 'app',
          protocol: PROTOCOL_VERSION,
          token: options.token,
          app: options.app,
          tools: descriptors(),
        });
        return;
      case 'welcome':
        welcomed = true;
        attempt = 0;
        lastError = undefined;
        status.set(bridgeStatus('connected', { lastClient: status.get().lastClient }));
        return;
      case 'error':
        lastError = String(frame.message ?? frame.code ?? 'error');
        if (frame.code === 'origin_rejected') {
          terminal = bridgeStatus('unauthorized', { message: 'This origin is not allowed by pixelmapper-mcp', lastError });
        }
        return;
      case 'call':
        if (welcomed) void calls.run(frame);
        return;
      case 'cancel':
        calls.cancel(frame.id, String(frame.reason ?? 'cancelled'));
        return;
      case 'ping':
        send({ type: 'pong', id: frame.id });
        return;
      case 'superseded':
        terminal = bridgeStatus('superseded', { lastError: String(frame.message ?? '') || undefined });
        return;
      default:
        return;
    }
  }

  /** Maps the close code to the next state and reconnects when allowed. */
  function handleClose(code: number): void {
    socket = null;
    welcomed = false;
    calls.cancelAll('connection closed');
    if (!running) return;
    let final = terminal;
    if (!final && code === CLOSE_CODES.unauthorized) final = bridgeStatus('unauthorized', { lastError });
    if (!final && code === CLOSE_CODES.superseded) final = bridgeStatus('superseded', { lastError });
    if (!final && code === CLOSE_CODES.protocolMismatch) final = bridgeStatus('incompatible', { lastError });
    if (final) {
      running = false;
      status.set(final);
      return;
    }
    scheduleRetry();
  }

  /** Waits for the next backoff step, showing "waiting for pixelmapper-mcp". */
  function scheduleRetry(): void {
    const delay = backoff[Math.min(attempt, backoff.length - 1)]!;
    attempt++;
    status.set(bridgeStatus('waiting', { lastError }));
    retryTimer = setTimeout(connect, delay);
  }

  return {
    start() {
      if (running) return;
      running = true;
      attempt = 0;
      lastError = undefined;
      connect();
    },
    stop() {
      running = false;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      calls.cancelAll('client stopped');
      const ws = socket;
      socket = null;
      ws?.close(1000, 'disabled');
      status.set(bridgeStatus('disabled'));
    },
    announceTools() {
      if (welcomed) send({ type: 'tools', tools: descriptors() });
    },
    getStatus: () => status.get(),
    subscribe: (listener) => status.subscribe(listener),
  };
}

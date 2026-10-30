/**
 * `BridgeTransport` over a WebSocket to `pmnet-bridge serve` (browser).
 *
 * Text frames are bridge messages; binary frames from the bridge are ignored
 * (none exist in protocol 1.0). Backpressure is the socket's `bufferedAmount`.
 */
import { ABNORMAL_CLOSE, type BridgeTransportFactory } from './bridge-transport';

/** Constructor of a WebSocket (injectable for tests). */
export type WebSocketFactory = new (url: string) => WebSocket;

/** WebSocket readyState OPEN. */
const WS_OPEN = 1;

/**
 * Factory of WebSocket transports. `WebSocketImpl` defaults to
 * `globalThis.WebSocket`; without one the factory throws.
 */
export function createWebSocketTransport(WebSocketImpl?: WebSocketFactory): BridgeTransportFactory {
  return (url, handlers) => {
    const Impl = WebSocketImpl ?? (globalThis.WebSocket as WebSocketFactory | undefined);
    if (!Impl) throw new Error('WebSocket not available');
    const ws = new Impl(url);
    ws.binaryType = 'arraybuffer';
    /** Set by `close()`: events of this socket are ignored afterwards. */
    let closed = false;
    ws.addEventListener('open', () => { if (!closed) handlers.onOpen(); });
    ws.addEventListener('message', (ev: MessageEvent) => {
      if (!closed && typeof ev.data === 'string') handlers.onMessage(ev.data);
    });
    ws.addEventListener('close', (ev: CloseEvent) => {
      if (closed) return;
      closed = true;
      handlers.onClose(ev?.code ?? ABNORMAL_CLOSE, ev?.reason ?? '');
    });
    ws.addEventListener('error', () => { /* `close` follows */ });
    return {
      get isOpen() {
        return !closed && ws.readyState === WS_OPEN;
      },
      get bufferedAmount() {
        return ws.bufferedAmount;
      },
      sendText(text) {
        ws.send(text);
      },
      sendBinary(data) {
        ws.send(data);
      },
      close() {
        closed = true;
        try { ws.close(); }
        catch { /* already closed */ }
      },
    };
  };
}

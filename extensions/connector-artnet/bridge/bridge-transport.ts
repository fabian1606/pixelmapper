/**
 * `BridgeTransport` — the byte pipe between `WsBridgeBackend` and a bridge.
 *
 * The backend keeps all protocol logic (handshake, correlation, reconnect,
 * frame sets); a transport only moves the contract's JSON text messages and
 * binary frame sets (`architecture/artnet-bridge-ws-protocol.md`). One
 * transport is created per connect attempt by a `BridgeTransportFactory`.
 *
 * Implementations: `createWebSocketTransport` (`pmnet-bridge serve`, browser)
 * and `createInProcessTransport` (bridge embedded in the desktop app, through
 * the platform's `artnetBridge`).
 */

/** Callbacks of a transport, called asynchronously (never from the factory call). */
export interface BridgeTransportHandlers {
  /** The transport is ready; `sendText`/`sendBinary` may be used. */
  onOpen(): void;
  /** One JSON text message of the bridge. */
  onMessage(text: string): void;
  /**
   * The transport is gone (also when it never opened): a contract close
   * code (4001/4002/4003/1001) or 1006 when there was none; `reason` may be
   * empty. Not called after `close()`.
   */
  onClose(code: number, reason: string): void;
}

/** One connection attempt to a bridge. */
export interface BridgeTransport {
  /** True between `onOpen` and the close. */
  readonly isOpen: boolean;
  /** Bytes queued for the bridge but not yet handed over (backpressure). */
  readonly bufferedAmount: number;
  /** Sends one JSON text message; may throw when the transport is gone. */
  sendText(text: string): void;
  /** Sends one binary message (frame set); may throw when the transport is gone. */
  sendBinary(data: Uint8Array): void;
  /** Ends the connection. Idempotent; no handler runs afterwards. */
  close(): void;
}

/**
 * Creates the transport of one connect attempt. `url` is the bridge URL
 * (WebSocket) or the display label of the transport; it may throw when the
 * transport cannot even be created (the backend then retries with backoff).
 */
export type BridgeTransportFactory = (url: string, handlers: BridgeTransportHandlers) => BridgeTransport;

/** Close code used when a transport ended without a contract code. */
export const ABNORMAL_CLOSE = 1006;

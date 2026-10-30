/**
 * `BridgeTransport` over the platform's in-process Art-Net bridge (desktop
 * app, `Platform.artnetBridge`). Same messages as the WebSocket, no socket.
 *
 * - `connect()` rejecting (the bridge could not start) is a close with 1006
 *   and the rejection message as reason, so the backend backs off and retries.
 * - Messages that arrive before the session is open are queued and delivered
 *   right after `onOpen` (the platform already promises this; kept here so
 *   any implementation of `ArtNetBridgeApi` is safe).
 * - A failed `sendText` means the session is gone: the transport closes
 *   itself and reports 1006, which fails the pending commands.
 */
import type { ArtNetBridgeApi, ArtNetBridgeSession } from '@pixelmapper/extension-api';
import { ABNORMAL_CLOSE, type BridgeTransportFactory } from './bridge-transport';

/** Display label of the in-process transport (`BackendState.url`). */
export const IN_PROCESS_BRIDGE_LABEL = 'built-in bridge';

/** Readable text of a rejection. */
function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Factory of transports to the in-process bridge of `api`. */
export function createInProcessTransport(api: ArtNetBridgeApi): BridgeTransportFactory {
  return (_label, handlers) => {
    let session: ArtNetBridgeSession | null = null;
    /** True once closed by either side; no handler runs afterwards. */
    let closed = false;
    /** Messages received before the session was open. */
    const early: string[] = [];

    /** Ends the transport from this side and reports it (once). */
    const fail = (code: number, reason: string) => {
      if (closed) return;
      closed = true;
      session?.close();
      handlers.onClose(code, reason);
    };

    api.connect({
      onMessage(text) {
        if (closed) return;
        if (session) handlers.onMessage(text);
        else early.push(text);
      },
      onClose(code, reason) {
        if (closed) return;
        closed = true;
        // Release the native session as well (disconnect is idempotent).
        session?.close();
        handlers.onClose(code, reason);
      },
    }).then(
      (s) => {
        if (closed) return s.close();
        session = s;
        handlers.onOpen();
        for (const text of early.splice(0)) {
          if (closed) return;
          handlers.onMessage(text);
        }
      },
      (e: unknown) => fail(ABNORMAL_CLOSE, errorText(e)),
    );

    return {
      get isOpen() {
        return !closed && session !== null;
      },
      get bufferedAmount() {
        return session?.bufferedAmount ?? 0;
      },
      sendText(text) {
        if (!session || closed) throw new Error('The built-in Art-Net bridge is not connected');
        session.sendText(text).catch((e: unknown) => fail(ABNORMAL_CLOSE, errorText(e)));
      },
      sendBinary(data) {
        if (!session || closed) throw new Error('The built-in Art-Net bridge is not connected');
        session.sendBinary(data);
      },
      close() {
        if (closed) return;
        closed = true;
        session?.close();
      },
    };
  };
}

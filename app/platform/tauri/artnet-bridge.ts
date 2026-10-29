/**
 * In-process Art-Net bridge for the Tauri platform (ADR 0003).
 *
 * Calls the `artnet_*` commands of `src-tauri/src/artnet.rs`, which run the
 * same bridge core as `pmnet-bridge serve`. Only the transport differs from
 * the WebSocket: bridge text messages and the close arrive on a `Channel`,
 * text goes out through `artnet_send_text`, DMX frame sets as raw IPC bodies
 * through `artnet_send_binary` (session id in a header, like `udp_send`).
 *
 * Ordering: the bridge greets (`hello`) as soon as the session exists, often
 * before `artnet_connect` resolves. Channel events are queued until the
 * session has been handed to the caller and delivered in order on the next
 * macrotask, so no handler runs before `connect()` resolved and the caller's
 * continuation has run.
 *
 * The other direction must stay ordered too (the bridge applies a
 * `dmxRoutes` to every later frame set), but Tauri runs async commands
 * concurrently, so two `invoke`s may overtake each other. Sends therefore go
 * through a FIFO: the next `artnet_send_*` starts when the previous one has
 * been handed to the session.
 */
import { Channel, invoke } from '@tauri-apps/api/core';
import type { ArtNetBridgeApi, ArtNetBridgeHandlers, ArtNetBridgeSession } from '@pixelmapper/extension-api';

/** Payload of the session channel (mirrors `ArtNetSessionEvent` in `artnet.rs`). */
export type ArtNetSessionEvent =
  | { kind: 'message'; text: string }
  | { kind: 'close'; code: number; reason: string };

/** IPC rejections are plain strings; callers get `Error`s. */
function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

/** Opens one bridge session (see file comment for the delivery order). */
async function connect(handlers: ArtNetBridgeHandlers): Promise<ArtNetBridgeSession> {
  /** Events received before the session was handed out; null once delivery is live. */
  let queue: ArtNetSessionEvent[] | null = [];
  /** True after the bridge's close or the caller's `close()`: nothing is delivered any more. */
  let ended = false;
  /** True after the caller's `close()` (makes it idempotent). */
  let disposed = false;
  /** Bytes of binary sends not yet settled by the native side. */
  let buffered = 0;
  /** Logs only the first failed binary send so a dead session cannot flood the console. */
  let warned = false;
  /** Sends waiting for the one in flight (see file comment). */
  const sendQueue: Array<() => Promise<unknown>> = [];
  /** True while one `artnet_send_*` is in flight. */
  let sending = false;

  /** Starts the next queued send unless one is in flight. */
  const pump = () => {
    if (sending) return;
    const next = sendQueue.shift();
    if (!next) return;
    sending = true;
    void next().finally(() => {
      sending = false;
      pump();
    });
  };

  /** Queues `send` behind earlier sends; settles with its result. */
  const enqueue = <T>(send: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    sendQueue.push(() => send().then(resolve, reject));
    pump();
  });

  /** Hands one event to the caller; the close is final. */
  const deliver = (event: ArtNetSessionEvent) => {
    if (ended) return;
    if (event.kind === 'message') return handlers.onMessage(event.text);
    ended = true;
    handlers.onClose(event.code, event.reason);
  };

  // The handler must be set before the channel is sent to the backend.
  const channel = new Channel<ArtNetSessionEvent>();
  channel.onmessage = (event) => {
    if (queue) queue.push(event);
    else deliver(event);
  };

  let id: number;
  try {
    id = await invoke<number>('artnet_connect', { onEvent: channel });
  }
  catch (e) {
    ended = true;
    queue = null;
    throw toError(e);
  }

  // Flush after the caller's `.then`/`await` continuation (microtasks) has run.
  setTimeout(() => {
    const early = queue ?? [];
    queue = null;
    for (const event of early) deliver(event);
  }, 0);

  return {
    sendText(text) {
      if (ended) return Promise.reject(new Error('The Art-Net bridge session is closed'));
      return enqueue(() => invoke('artnet_send_text', { session: id, text })).then(() => undefined, (e: unknown) => {
        throw toError(e);
      });
    },
    sendBinary(data) {
      if (ended) return;
      const size = data.byteLength;
      buffered += size;
      enqueue(() => invoke('artnet_send_binary', data, { headers: { 'x-session': String(id) } }))
        .catch((e: unknown) => {
          if (warned) return;
          warned = true;
          console.warn('[artnet] sending a frame set to the built-in bridge failed:', e);
        })
        .finally(() => { buffered -= size; });
    },
    get bufferedAmount() {
      return buffered;
    },
    close() {
      if (disposed) return;
      disposed = true;
      ended = true;
      queue = null;
      // Queued sends are moot once the session is gone.
      sendQueue.length = 0;
      invoke('artnet_disconnect', { session: id }).catch((e: unknown) => {
        console.warn('[artnet] closing the built-in bridge session failed:', e);
      });
    },
  };
}

/** Creates the native `ArtNetBridgeApi`. */
export function createTauriArtNetBridge(): ArtNetBridgeApi {
  return { connect };
}

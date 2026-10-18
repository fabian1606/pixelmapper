/**
 * Native UDP for the Tauri platform (ADR 0003, step 2).
 *
 * Calls the `udp_*` commands of `src-tauri/src/udp.rs`. Datagrams are sent
 * as raw IPC bodies (no JSON encoding of the bytes); the target travels in
 * headers. Sends are fire-and-forget: a failure is logged, never thrown,
 * because they happen at frame rate.
 */
import { invoke } from '@tauri-apps/api/core';
import type { UdpApi, UdpSocket } from '@pixelmapper/extension-api';

/** Wraps a backend socket id. */
function wrapSocket(id: number): UdpSocket {
  let closed = false;
  /** Logs only the first failure per socket so a dead target cannot flood the console. */
  let warned = false;
  return {
    send(data, host, port) {
      if (closed) return;
      invoke('udp_send', data, {
        headers: { 'x-socket': String(id), 'x-host': host, 'x-port': String(port) },
      }).catch((e: unknown) => {
        if (warned) return;
        warned = true;
        console.warn(`[udp] send to ${host}:${port} failed:`, e);
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      await invoke('udp_close', { id });
    },
  };
}

/** Creates the native `UdpApi`. */
export function createTauriUdp(): UdpApi {
  return {
    async bind(options) {
      const id = await invoke<number>('udp_bind', { port: options?.port ?? 0, broadcast: options?.broadcast ?? false });
      return wrapSocket(id);
    },
  };
}

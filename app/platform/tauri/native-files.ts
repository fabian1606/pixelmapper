/**
 * Native HTTP and bundled resources for the Tauri platform (API 1.3,
 * ADR 0004 D19). Calls `http_get_bytes` / `resource_read` of
 * `src-tauri/src/net.rs`; bytes come back as raw IPC bodies.
 */
import { invoke } from '@tauri-apps/api/core';
import type { HttpApi, ResourcesApi } from '@pixelmapper/extension-api';

/** Error text of `resource_read` for a file that was not bundled. */
const NOT_BUNDLED = 'not_bundled';

/** Normalizes the raw IPC answer (ArrayBuffer, or a number array on older IPC paths). */
function toBytes(answer: ArrayBuffer | number[]): Uint8Array {
  return answer instanceof ArrayBuffer ? new Uint8Array(answer) : Uint8Array.from(answer);
}

/** Native HTTP GET (no CORS; hosts are restricted in the backend). */
export function createTauriHttp(): HttpApi {
  return {
    async getBytes(url) {
      return toBytes(await invoke<ArrayBuffer | number[]>('http_get_bytes', { url }));
    },
  };
}

/** Read-only access to files under the app's `resources/` directory. */
export function createTauriResources(): ResourcesApi {
  return {
    async read(path) {
      try {
        return toBytes(await invoke<ArrayBuffer | number[]>('resource_read', { path }));
      }
      catch (err) {
        if (String(err) === NOT_BUNDLED) return null;
        throw err instanceof Error ? err : new Error(String(err));
      }
    },
  };
}

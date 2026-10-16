/**
 * Tauri platform (ADR 0003 D4): the web platform plus native overrides.
 *
 * Every capability not yet ported keeps its web implementation (or `null`
 * where WKWebView lacks it). Migration steps replace entries here with
 * implementations that call the Rust backend via `invoke`/`Channel`:
 * step 2 `udp`, step 3 `serial` and `midi`.
 */
import type { Platform } from '@pixelmapper/extension-api';
import { createWebPlatform } from '../web';

/** Entry point resolved by the `#platform` alias in Tauri builds. */
export function createPlatform(): Platform {
  return {
    ...createWebPlatform(),
    kind: 'tauri',
  };
}

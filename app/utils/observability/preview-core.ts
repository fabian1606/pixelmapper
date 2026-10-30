/**
 * Headless engine for `preview` observations.
 *
 * Previews run the real `rs-engine-core` (the same WASM build as the engine
 * worker) on the main thread, in a private `WasmEngine` with a private plugin
 * bridge. This keeps preview values exact (Frame/Sample filling, room/u/v,
 * distribution, blend and color systems all come from the Rust core) without
 * a TypeScript twin of the render loop.
 *
 * The core module loads lazily once; tests inject a Node loader with
 * `setPreviewCoreLoader` (the browser loader fetches the wasm by URL).
 */

/** The subset of the `rs-engine-core` engine API previews use. */
export interface HeadlessEngine {
  reset_clock(bpm: number): void;
  render(timeMs: number, deltaMs: number): void;
  dispatch(packetType: number, data: Uint8Array): number;
  read_head_signatures(requests: Uint32Array): Float32Array;
  free(): void;
}

/** The loaded core module. */
export interface HeadlessCore {
  WasmEngine: new () => HeadlessEngine;
}

/** Loads and initializes the core module. */
export type CoreLoader = () => Promise<HeadlessCore>;

/** Browser loader: the bundled `rs-engine-core` with its wasm URL. */
const browserLoader: CoreLoader = async () => {
  const [core, url] = await Promise.all([
    import('rs-engine-core'),
    import('rs-engine-core/rs_engine_core_bg.wasm?url'),
  ]);
  await core.default({ module_or_path: url.default });
  return core as unknown as HeadlessCore;
};

let loader: CoreLoader = browserLoader;
let loaded: Promise<HeadlessCore> | null = null;

/** Replaces the core loader (tests / headless hosts); resets the cache. */
export function setPreviewCoreLoader(next: CoreLoader | null): void {
  loader = next ?? browserLoader;
  loaded = null;
}

/** The initialized core (loaded once). */
export function loadPreviewCore(): Promise<HeadlessCore> {
  if (!loaded) {
    loaded = loader().catch((err) => {
      loaded = null;
      throw err;
    });
  }
  return loaded;
}

/** Name of the global the core's JS runtime snippet calls. */
const BRIDGE_GLOBAL = '__pmPluginBridge';

/**
 * Runs `fn` with `bridge` installed as the core's plugin runtime and restores
 * the previous global afterwards (synchronous, so no other engine on this
 * thread can observe the swap).
 */
export function withPluginBridge<T>(bridge: unknown, fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const prev = g[BRIDGE_GLOBAL];
  g[BRIDGE_GLOBAL] = bridge;
  try {
    return fn();
  }
  finally {
    if (prev === undefined) delete g[BRIDGE_GLOBAL];
    else g[BRIDGE_GLOBAL] = prev;
  }
}

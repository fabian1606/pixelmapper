/**
 * Host ↔ engine handshake.
 *
 * The engine worker checks the loaded WASM modules before rendering: a
 * missing, stale or foreign build (e.g. resolved from another checkout)
 * used to load fine and render black, because it parsed newer packets as
 * empty. A mismatch is now an `EngineFailure` the app shows to the user.
 */

/**
 * Interface version the host expects; must equal `ENGINE_ABI_VERSION` in
 * `rs-engine/core/src/lib.rs` (checked by `engine-abi.test.ts`). Bump both
 * on every incompatible change to the `WasmEngine` API or a packet format.
 */
export const ENGINE_ABI_VERSION = 4;

/** `WasmEngine` methods the worker and previews call. */
export const REQUIRED_ENGINE_METHODS = [
  'set_bpm_at', 'reset_clock', 'align_beat', 'beat_time', 'base_beat_time', 'speed_time',
  'request_speed', 'speed', 'render', 'dispatch', 'retry_disabled',
  'read_signatures', 'read_head_signatures', 'get_dmx_view',
] as const;

/** `WasmCanvas` methods the worker calls. */
export const REQUIRED_CANVAS_METHODS = [
  'init_gl', 'draw', 'sync_fixtures', 'set_camera', 'set_viewport', 'set_world',
  'set_marquee', 'set_selected', 'set_remote_selections',
] as const;

/** How to fix a broken engine build (shown with every failure). */
export const ENGINE_REBUILD_HINT = 'Rebuild the engine with `bun run build:wasm` and restart the dev server.';

/** Why the engine cannot render. */
export interface EngineFailure {
  /** `load`: worker/WASM failed to load; `abi`: wrong build; `render`/`dispatch`: runtime error. */
  kind: 'load' | 'abi' | 'render' | 'dispatch';
  message: string;
  /** Fatal failures stop the engine (no frames are produced). */
  fatal: boolean;
}

/** Methods from `required` missing on `cls.prototype`. */
function missingMethods(cls: unknown, required: readonly string[]): string[] {
  const proto = (cls as { prototype?: Record<string, unknown> } | undefined)?.prototype;
  if (!proto) return [...required];
  return required.filter(m => typeof proto[m] !== 'function');
}

/**
 * Checks the loaded engine modules (after their WASM was initialized).
 * Returns null when they match this host, else a description of the mismatch.
 */
export function checkEngineModules(core: Record<string, unknown>, canvas?: Record<string, unknown>): string | null {
  const problems: string[] = [];
  const abi = typeof core.engine_abi_version === 'function'
    ? (core.engine_abi_version as () => number)()
    : null;
  if (abi === null) problems.push('rs-engine-core has no ABI version (build predates the handshake)');
  else if (abi !== ENGINE_ABI_VERSION) problems.push(`rs-engine-core ABI ${abi}, app expects ${ENGINE_ABI_VERSION}`);
  const engineMissing = missingMethods(core.WasmEngine, REQUIRED_ENGINE_METHODS);
  if (engineMissing.length > 0) problems.push(`WasmEngine lacks ${engineMissing.join(', ')}`);
  if (canvas) {
    const canvasMissing = missingMethods(canvas.WasmCanvas, REQUIRED_CANVAS_METHODS);
    if (canvasMissing.length > 0) problems.push(`WasmCanvas lacks ${canvasMissing.join(', ')}`);
  }
  return problems.length > 0 ? `Engine build does not match the app: ${problems.join('; ')}.` : null;
}

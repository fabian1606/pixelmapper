// Plugin bridge snippet imported by rs-engine-core (runtime_js.rs).
// wasm-bindgen requires a JS module here; it only forwards to the
// TypeScript bridge installed by app/utils/plugins/worker-bridge.ts.

/** Binds an instance to a plugin with params. */
export function pm_bridge_prepare(instance, plugin, params) {
  const b = globalThis.__pmPluginBridge;
  return b ? b.prepare(instance, plugin, params) : false;
}

/** Renders samples; writes into `out` (a view into the engine memory). */
export function pm_bridge_render(instance, ctx, samples, count, out) {
  const b = globalThis.__pmPluginBridge;
  return b ? b.render(instance, ctx, samples, count, out) : false;
}

/** Releases an instance. */
export function pm_bridge_release(instance) {
  globalThis.__pmPluginBridge?.release(instance);
}

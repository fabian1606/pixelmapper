/**
 * Worker-side plugin bridge (ADR §6.8, plan P3.9).
 *
 * Implements the browser `ModifierRuntime`: rs-engine-core calls
 * `globalThis.__pmPluginBridge.{prepare,render,release}` through its JS
 * snippet (`rs-engine/core/js/plugin-bridge.js`). The bridge owns the
 * compiled modules (by hash) and one `PluginInstance` (own memory, buffers,
 * budget) per modifier instance key, and copies samples/outputs between the
 * engine's memory and the plugin's memory.
 *
 * Errors (traps, aborts, budget overruns) disable the instance in the engine
 * (the call returns false) and are reported to the main thread.
 */
import { PluginInstance, PluginTrap } from '@pixelmapper/plugin-toolchain/runtime';

/** Messages the bridge posts to the main thread. */
export type BridgeEvent =
  | { type: 'plugin-error'; instance: number; hash: string; message: string; reason: PluginTrap['reason'] | 'missing' }
  | { type: 'plugin-log'; hash: string; message: string };

/** A live instance and the plugin it runs. */
interface BoundInstance {
  hash: string;
  plugin: PluginInstance;
}

/** Max `pm.log` messages per plugin per second (dev aid, rate-limited). */
const LOG_RATE = 10;

export class WorkerPluginBridge {
  private modules = new Map<string, WebAssembly.Module>();
  private instances = new Map<number, BoundInstance>();
  /** Plugin index → hash, from the latest modifiers-sync. */
  private table: string[] = [];
  /** Hashes that must not run (suspended by the watchdog). */
  private suspended = new Set<string>();
  private logBudget = new Map<string, { second: number; count: number }>();

  constructor(private readonly post: (event: BridgeEvent) => void) {}

  /** Installs this bridge as the engine's runtime. */
  install(): void {
    (globalThis as { __pmPluginBridge?: unknown }).__pmPluginBridge = this;
  }

  // ── Modules ───────────────────────────────────

  /** Compiles and caches a plugin module (sync compile is fine in a worker). */
  load(hash: string, wasm: ArrayBuffer | Uint8Array): void {
    if (this.modules.has(hash)) return;
    this.modules.set(hash, new WebAssembly.Module(wasm instanceof Uint8Array ? new Uint8Array(wasm) : wasm));
  }

  /** Drops a module and every instance running it. */
  unload(hash: string): void {
    this.modules.delete(hash);
    for (const [key, b] of this.instances) if (b.hash === hash) this.instances.delete(key);
  }

  /** True when the module is loaded. */
  has(hash: string): boolean {
    return this.modules.has(hash);
  }

  /** Sets the plugin table of the current modifiers packet. */
  setTable(hashes: string[]): void {
    this.table = hashes.slice();
  }

  /** Marks hashes as suspended (or clears with an empty list). */
  setSuspended(hashes: string[]): void {
    this.suspended = new Set(hashes);
    for (const [key, b] of this.instances) if (this.suspended.has(b.hash)) this.instances.delete(key);
  }

  // ── Runtime calls (from rs-engine-core) ──────

  /** Binds `instance` to plugin `pluginIndex` and hands it the params. */
  prepare(instance: number, pluginIndex: number, params: Float32Array): boolean {
    const hash = this.table[pluginIndex];
    if (!hash || this.suspended.has(hash)) return false;
    const module = this.modules.get(hash);
    if (!module) return false; // not loaded yet; the engine retries after plugin-load
    try {
      let bound = this.instances.get(instance);
      if (!bound || bound.hash !== hash) {
        bound = { hash, plugin: PluginInstance.createSync(module, { log: m => this.log(hash, m) }) };
        this.instances.set(instance, bound);
      }
      bound.plugin.prepare(params);
      return true;
    }
    catch (err) {
      this.fail(instance, hash, err);
      return false;
    }
  }

  /** Renders `count` samples into `out` (a view into the engine's memory). */
  render(instance: number, ctx: Float32Array, samples: Float32Array, count: number, out: Float32Array): boolean {
    const bound = this.instances.get(instance);
    if (!bound) return false;
    try {
      bound.plugin.render(ctx, samples, count, out);
      return true;
    }
    catch (err) {
      this.fail(instance, bound.hash, err);
      return false;
    }
  }

  /** Frees an instance. */
  release(instance: number): void {
    this.instances.delete(instance);
  }

  // ── Helpers ───────────────────────────────────

  /** Drops a failed instance and reports it. */
  private fail(instance: number, hash: string, err: unknown): void {
    this.instances.delete(instance);
    const trap = err instanceof PluginTrap ? err : null;
    this.post({
      type: 'plugin-error',
      instance,
      hash,
      message: trap ? trap.message : String(err),
      reason: trap ? trap.reason : 'trap',
    });
  }

  /** Forwards `pm.log`, at most LOG_RATE messages per second per plugin. */
  private log(hash: string, message: string): void {
    const second = Math.floor(Date.now() / 1000);
    const b = this.logBudget.get(hash);
    if (!b || b.second !== second) this.logBudget.set(hash, { second, count: 1 });
    else if (++b.count > LOG_RATE) return;
    this.post({ type: 'plugin-log', hash, message });
  }
}

/**
 * Plugin instance runtime (ADR §6.6–6.8). Isomorphic and lightweight
 * (`@pixelmapper/plugin-toolchain/runtime`): used by the validation harness,
 * the engine worker bridge and the main-thread preview pool.
 *
 * Each instance owns its `WebAssembly.Memory` (max 256 pages = 16 MiB) and
 * host buffers allocated through `pm_alloc`. The only imports are
 * `env.memory`, `env.abort`, `pm.budget` (instrumentation) and `pm.log`.
 */

/** f32 slots of the frame context. */
export const CTX_FIELDS = 16;
/** f32 slots per sample. */
export const SAMPLE_FIELDS = 16;
/** Maximum memory pages of a plugin (16 MiB). */
export const MAX_PAGES = 256;
/** Imports a plugin module may declare. */
export const ALLOWED_IMPORTS: readonly string[] = ['env.abort', 'env.memory', 'pm.budget', 'pm.log'];

/** Field offsets of the frame context (f32 index). */
export const CTX = {
  timeMs: 0, beatTime: 1, bpm: 2, phaseSpeed: 3, arity: 4, seedLo: 5, seedHi: 6, strength: 7,
  // ABI v1.1 (ADR A20)
  timePhase: 8, rankCount: 9, distGroupCount: 10,
  // ABI v1.2: 0 all the same, 1 spatial 2D, 2 fixture by fixture, 3 within each fixture
  spread: 11,
} as const;
/** Field offsets of a sample (f32 index). */
export const SAMPLE = {
  x: 0, y: 1, phase: 2, groupIndex: 3, groupCount: 4, headIndex: 5, headCount: 6, seed: 7,
  base0: 8, base1: 9, base2: 10, channelSeedLo: 11, channelSeedHi: 12,
  // ABI v1.1 (ADR A20)
  spatial: 13, rank: 14, distGroup: 15,
} as const;

/** Thrown when a plugin traps, aborts or exceeds its budget. */
export class PluginTrap extends Error {
  constructor(message: string, readonly reason: 'budget' | 'abort' | 'trap') {
    super(message);
    this.name = 'PluginTrap';
  }
}

/** Options of an instance. */
export interface PluginRuntimeOptions {
  /** Budget base per `pm_render` call (default 50 000). */
  budgetBase?: number;
  /** Additional budget per sample (default 2 000). */
  budgetPerSample?: number;
  /** Receives `pm.log` messages (rate-limited by the caller); omitted = ignored. */
  log?: (message: string) => void;
}

/** Disallowed imports of a module (empty = OK). */
export function forbiddenImports(module: WebAssembly.Module): string[] {
  return WebAssembly.Module.imports(module)
    .map(i => `${i.module}.${i.name}`)
    .filter(n => !ALLOWED_IMPORTS.includes(n));
}

/** Plugin exports of ABI v1. */
interface AbiExports {
  pm_abi_version(): number;
  pm_alloc(bytes: number): number;
  pm_prepare(params: number, count: number): void;
  pm_render(ctx: number, samples: number, count: number, out: number): void;
}

/** A buffer allocated in plugin memory. */
interface Region {
  ptr: number;
  /** Capacity in f32 slots. */
  cap: number;
}

/** Mutable budget shared between the import hooks and the instance. */
interface BudgetState {
  left: number;
}

/** Budget for module start code (top-level statements) during instantiation. */
const START_BUDGET = 1_000_000;

/** One running plugin instance. */
export class PluginInstance {
  private ctxRegion: Region | null = null;
  private sampleRegion: Region | null = null;
  private outRegion: Region | null = null;
  private paramRegion: Region | null = null;

  private constructor(
    private readonly exports: AbiExports,
    private readonly memory: WebAssembly.Memory,
    private readonly budget: BudgetState,
    private readonly opts: Required<Pick<PluginRuntimeOptions, 'budgetBase' | 'budgetPerSample'>>,
  ) {}

  /** Builds the import object and the budget/abort hooks. */
  private static imports(memory: WebAssembly.Memory, budget: BudgetState, log?: (m: string) => void) {
    return {
      env: {
        memory,
        abort(msgPtr: number, filePtr: number, line: number, col: number) {
          const msg = readAsString(memory, msgPtr);
          const file = readAsString(memory, filePtr);
          throw new PluginTrap(`abort: ${msg} (${file}:${line}:${col})`, 'abort');
        },
      },
      pm: {
        budget() {
          if (--budget.left < 0) throw new PluginTrap('iteration budget exceeded (infinite loop?)', 'budget');
        },
        log(ptr: number, len: number) {
          if (!log) return;
          log(new TextDecoder().decode(new Uint8Array(memory.buffer, ptr, len)));
        },
      },
    };
  }

  /** Memory for a module: its declared minimum, max 256 pages. */
  private static memoryFor(module: WebAssembly.Module): WebAssembly.Memory {
    const desc = WebAssembly.Module.imports(module).find(i => i.module === 'env' && i.name === 'memory');
    const min = (desc as unknown as { type?: { minimum?: number } })?.type?.minimum ?? 1;
    return new WebAssembly.Memory({ initial: Math.max(1, min), maximum: MAX_PAGES });
  }

  /** Validates imports and the ABI version of an instance. */
  private static check(module: WebAssembly.Module, exports: AbiExports): void {
    const bad = forbiddenImports(module);
    if (bad.length > 0) throw new PluginTrap(`forbidden imports: ${bad.join(', ')}`, 'trap');
    if (typeof exports.pm_render !== 'function' || exports.pm_abi_version?.() !== 1) {
      throw new PluginTrap('not a pixelmapper plugin (ABI v1 exports missing)', 'trap');
    }
  }

  /** Instantiates synchronously (workers / tests). */
  static createSync(module: WebAssembly.Module, opts: PluginRuntimeOptions = {}): PluginInstance {
    const bad = forbiddenImports(module);
    if (bad.length > 0) throw new PluginTrap(`forbidden imports: ${bad.join(', ')}`, 'trap');
    const memory = PluginInstance.memoryFor(module);
    const budget: BudgetState = { left: START_BUDGET };
    const wasm = PluginInstance.trapping(() => new WebAssembly.Instance(module, PluginInstance.imports(memory, budget, opts.log)));
    const exports = wasm.exports as unknown as AbiExports;
    PluginInstance.check(module, exports);
    return new PluginInstance(exports, memory, budget, PluginInstance.limits(opts));
  }

  /** Instantiates asynchronously (main thread). */
  static async create(module: WebAssembly.Module, opts: PluginRuntimeOptions = {}): Promise<PluginInstance> {
    const bad = forbiddenImports(module);
    if (bad.length > 0) throw new PluginTrap(`forbidden imports: ${bad.join(', ')}`, 'trap');
    const memory = PluginInstance.memoryFor(module);
    const budget: BudgetState = { left: START_BUDGET };
    let wasm: WebAssembly.Instance;
    try {
      wasm = await WebAssembly.instantiate(module, PluginInstance.imports(memory, budget, opts.log));
    }
    catch (err) {
      throw err instanceof PluginTrap ? err : new PluginTrap(`trap: ${(err as Error).message}`, 'trap');
    }
    const exports = wasm.exports as unknown as AbiExports;
    PluginInstance.check(module, exports);
    return new PluginInstance(exports, memory, budget, PluginInstance.limits(opts));
  }

  /** Budget limits with defaults. */
  private static limits(opts: PluginRuntimeOptions) {
    return { budgetBase: opts.budgetBase ?? 50_000, budgetPerSample: opts.budgetPerSample ?? 2_000 };
  }

  /** Runs `fn` translating wasm errors into `PluginTrap` (static variant). */
  private static trapping<T>(fn: () => T): T {
    try {
      return fn();
    }
    catch (err) {
      if (err instanceof PluginTrap) throw err;
      throw new PluginTrap(`trap: ${(err as Error).message}`, 'trap');
    }
  }

  /** Ensures a region of at least `slots` f32 (grows by doubling). */
  private ensure(region: Region | null, slots: number): Region {
    if (region && region.cap >= slots) return region;
    const cap = Math.max(16, slots, (region?.cap ?? 0) * 2);
    this.budget.left = Number.MAX_SAFE_INTEGER; // allocation itself is trusted SDK code
    const ptr = this.exports.pm_alloc(cap * 4);
    return { ptr, cap };
  }

  /** Runs `fn` translating wasm traps into `PluginTrap`. */
  private guard<T>(fn: () => T): T {
    try {
      return fn();
    }
    catch (err) {
      if (err instanceof PluginTrap) throw err;
      throw new PluginTrap(`trap: ${(err as Error).message}`, 'trap');
    }
  }

  /** Hands params to the plugin (on load and on param change). */
  prepare(params: Float32Array): void {
    this.guard(() => {
      this.paramRegion = this.ensure(this.paramRegion, Math.max(1, params.length));
      new Float32Array(this.memory.buffer, this.paramRegion.ptr, params.length).set(params);
      this.budget.left = this.opts.budgetBase;
      this.exports.pm_prepare(this.paramRegion.ptr, params.length);
    });
  }

  /**
   * Renders `count` samples. `ctx` = 16 f32 (arity at index 4), `samples` =
   * count × 16 f32. Writes count × arity f32 into `out` (allocated if omitted).
   */
  render(ctx: Float32Array, samples: Float32Array, count: number, out?: Float32Array): Float32Array {
    const arity = Math.max(1, Math.round(ctx[CTX.arity] ?? 1));
    const result = out ?? new Float32Array(count * arity);
    if (count === 0) return result;
    return this.guard(() => {
      this.ctxRegion = this.ensure(this.ctxRegion, CTX_FIELDS);
      this.sampleRegion = this.ensure(this.sampleRegion, count * SAMPLE_FIELDS);
      this.outRegion = this.ensure(this.outRegion, count * arity);
      const buf = this.memory.buffer;
      new Float32Array(buf, this.ctxRegion.ptr, CTX_FIELDS).set(ctx.subarray(0, CTX_FIELDS));
      new Float32Array(buf, this.sampleRegion.ptr, count * SAMPLE_FIELDS).set(samples.subarray(0, count * SAMPLE_FIELDS));
      this.budget.left = this.opts.budgetBase + this.opts.budgetPerSample * count;
      this.exports.pm_render(this.ctxRegion.ptr, this.sampleRegion.ptr, count, this.outRegion.ptr);
      // Re-read the buffer: the plugin may have grown its memory.
      result.set(new Float32Array(this.memory.buffer, this.outRegion.ptr, count * arity));
      return result;
    });
  }
}

/** Reads an AssemblyScript string (UTF-16, byte length at ptr − 4). */
function readAsString(memory: WebAssembly.Memory, ptr: number): string {
  if (!ptr) return '';
  try {
    const bytes = new Uint32Array(memory.buffer, ptr - 4, 1)[0]!;
    return String.fromCharCode(...new Uint16Array(memory.buffer, ptr, bytes >>> 1));
  }
  catch {
    return '<unreadable>';
  }
}

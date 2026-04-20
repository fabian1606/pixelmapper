import { reactive, ref, type Ref } from 'vue';
import initWasm, { WasmEngine } from 'rs-engine-core';
import wasmUrl from 'rs-engine-core/rs_engine_core_bg.wasm?url';

// We must initialize the Wasm module before we can use WasmEngine
let isWasmInitialized = false;

export class EffectEngine {
  public effects = reactive<import('~/utils/engine/types').Effect[]>([]);
  public stackBlendMode = ref<import('~/utils/engine/types').BlendMode>('add');
  public activeModifier: Ref<import('~/utils/engine/types').Effect | null> = ref(null);

  /**
   * Global BPM for the engine, used to calculate beat-based speeds.
   */
  public globalBpm = ref<number>(120);

  public wasmEngine: WasmEngine | null = null;

  /**
   * The DMX buffer mapped directly from Wasm memory.
   * Access via buffer[startAddress - 1 + addressOffset].
   */
  public dmxBuffer: Uint8Array = new Uint8Array(512);
  public absTimeMs: number = 0;

  /** Resolves when WASM is loaded and wasmEngine is ready. */
  public readonly ready: Promise<void>;

  constructor() {
    if (typeof window !== 'undefined') {
      this.ready = this.init();
    } else {
      this.ready = Promise.resolve();
    }
  }

  private async init() {
    if (!isWasmInitialized) {
      await initWasm(wasmUrl);
      isWasmInitialized = true;
    }
    this.wasmEngine = new WasmEngine();
    this.wasmEngine.set_bpm(this.globalBpm.value);
    this.dmxBuffer = this.wasmEngine.get_dmx_view();
  }

  /**
   * Dispatch a binary packet to the WASM engine.
   * packet_type: TYPE_LAYOUT_BIN(0x14), TYPE_CHAN_BIN(0x15), TYPE_FX_BIN(0x16)
   * Returns the count of parsed items, or -1 on error.
   */
  public dispatch(packetType: number, data: Uint8Array): number {
    if (!this.wasmEngine) return -1;
    return this.wasmEngine.dispatch(packetType, data);
  }

  public addEffect(effect: import('~/utils/engine/types').Effect) {
    this.effects.push(effect);
  }

  public clearEffects() {
    this.effects.splice(0, this.effects.length);
  }

  public render(timeMs: number, deltaTimeMs: number): void {
    if (!this.wasmEngine) return;
    this.absTimeMs = timeMs;

    this.wasmEngine.set_bpm(this.globalBpm.value);
    this.wasmEngine.render(timeMs, deltaTimeMs);

    // Re-fetch the view — Wasm memory may have grown during binary parsing,
    // which would detach the old Uint8Array reference.
    this.dmxBuffer = this.wasmEngine.get_dmx_view();
  }
}

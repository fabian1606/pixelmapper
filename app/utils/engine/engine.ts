import { reactive, ref, type Ref } from 'vue';

export class EffectEngine {
  public effects = reactive<import('~/utils/engine/types').Effect[]>([]);
  public stackBlendMode = ref<import('~/utils/engine/types').BlendMode>('add');
  public activeModifier: Ref<import('~/utils/engine/types').Effect | null> = ref(null);
  public globalBpm = ref<number>(120);

  /**
   * Latest DMX frame received from the worker.
   * Updated on every frame message — consumers should react to bufferRevision,
   * not poll this directly.
   */
  public dmxBuffer: Uint8Array = new Uint8Array(512);

  /** Resolves when the worker WASM engine is ready to receive packets. */
  public readonly ready: Promise<void>;

  /** Called by the worker frame-receive handler in engine-store. */
  public onFrame: ((dmx: Uint8Array, elapsedMs: number) => void) | null = null;

  private worker: Worker | null = null;
  private readyResolve!: () => void;

  constructor() {
    this.ready = new Promise<void>((resolve) => { this.readyResolve = resolve; });
    if (typeof window !== 'undefined') {
      this.worker = new Worker(new URL('./engine-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent) => {
        const m = e.data as { type: string; dmx?: Uint8Array; elapsedMs?: number };
        if (m.type === 'ready') {
          this.readyResolve();
        } else if (m.type === 'frame' && m.dmx && m.elapsedMs !== undefined) {
          this.dmxBuffer = m.dmx;
          this.onFrame?.(m.dmx, m.elapsedMs);
        }
      };
      this.worker.onerror = (e) => console.error('[engine-worker] error:', e);
    } else {
      // SSR: resolve immediately, no worker
      this.readyResolve();
    }
  }

  /**
   * Dispatch a binary packet to the worker WASM engine.
   * Data is copied into a fresh ArrayBuffer for zero-overhead transfer.
   */
  public dispatch(packetType: number, data: Uint8Array): number {
    if (!this.worker) return -1;
    const copy = new Uint8Array(data.length);
    copy.set(data);
    this.worker.postMessage({ type: 'dispatch', packetType, data: copy.buffer }, [copy.buffer]);
    return 0;
  }

  public postBpm(bpm: number): void {
    this.worker?.postMessage({ type: 'bpm', bpm });
  }

  public postEpoch(epoch: number): void {
    this.worker?.postMessage({ type: 'epoch', epoch });
  }

  public reset(): void {
    this.worker?.postMessage({ type: 'reset' });
  }

  // ── Canvas (OffscreenCanvas in worker) ─────────────────────────────────────

  /** Transfer the OffscreenCanvas to the worker. Call once after mount. */
  public initCanvas(offscreen: OffscreenCanvas): void {
    this.worker?.postMessage({ type: 'canvas.init', offscreen }, [offscreen]);
  }

  public resizeCanvas(w: number, h: number): void {
    this.worker?.postMessage({ type: 'canvas.resize', viewportW: w, viewportH: h });
  }

  public syncCanvasFixtures(json: string): void {
    this.worker?.postMessage({ type: 'canvas.sync_fixtures', json });
  }

  public setCanvasCamera(x: number, y: number, scale: number): void {
    this.worker?.postMessage({ type: 'canvas.set_camera', cameraX: x, cameraY: y, cameraScale: scale });
  }

  public setCanvasViewport(w: number, h: number): void {
    this.worker?.postMessage({ type: 'canvas.set_viewport', viewportW: w, viewportH: h });
  }

  public setCanvasWorld(w: number, h: number): void {
    this.worker?.postMessage({ type: 'canvas.set_world', worldW: w, worldH: h });
  }

  public setCanvasMarquee(active: boolean, sx: number, sy: number, ex: number, ey: number): void {
    this.worker?.postMessage({
      type: 'canvas.set_marquee',
      marqueeActive: active, marqueeSx: sx, marqueeSy: sy, marqueeEx: ex, marqueeEy: ey,
    });
  }

  public setCanvasSelected(ids: Array<string | number>): void {
    this.worker?.postMessage({ type: 'canvas.set_selected', ids });
  }

  public setCanvasRemoteSelections(json: string): void {
    this.worker?.postMessage({ type: 'canvas.set_remote_selections', json });
  }

  public addEffect(effect: import('~/utils/engine/types').Effect) {
    this.effects.push(effect);
  }

  public clearEffects() {
    this.effects.splice(0, this.effects.length);
  }

  /** No-op — worker renders on its own interval. */
  public render(_timeMs: number, _deltaTimeMs: number): void {}
}

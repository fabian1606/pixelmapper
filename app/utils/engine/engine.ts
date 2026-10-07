/**
 * Main-thread owner of the engine worker.
 *
 * Forwards packets, tempo, clock epoch, plugin modules and canvas messages to
 * the worker and receives rendered frames. Keeps the latest state of each so
 * the watchdog (plan P3.10) can terminate a hung worker, respawn it and
 * replay everything — with non-built-in plugins suspended.
 */
import { reactive, ref, shallowRef, type Ref } from 'vue';
import { Watchdog } from '~/utils/plugins/watchdog';
import type { BlendMode, ModifierInstance } from './types';
import type { SignatureFrame } from '~/utils/extensions/live-hub';

/** Events reported by the worker's plugin bridge. */
export type PluginEvent =
  | { type: 'plugin-error'; instance: number; hash: string; message: string; reason: string }
  | { type: 'plugin-log'; hash: string; message: string };

export class EffectEngine {
  /** The modifier list (shared with the engine store's `modifiers`). */
  public modifiers = reactive<ModifierInstance[]>([]);
  /** Blend mode for new modifiers; the stack-mode selector applies it to all. */
  public stackBlendMode = ref<BlendMode>('add');
  /** Modifier selected in the UI (spatial handles, editor). */
  public activeModifier: Ref<ModifierInstance | null> = ref(null);
  public globalBpm = ref<number>(120);

  /** Latest DMX frame received from the worker. */
  public dmxBuffer: Uint8Array = new Uint8Array(512);

  /** Resolves when the (first) worker WASM engine is ready. */
  public readonly ready: Promise<void>;

  /** Called for every rendered frame (engine store). */
  public onFrame: ((dmx: Uint8Array, elapsedMs: number, signatures?: SignatureFrame) => void) | null = null;

  /** Called for plugin errors/logs from the worker. */
  public onPluginEvent: ((event: PluginEvent) => void) | null = null;

  /** Called after a watchdog respawn with the suspended plugin hashes. */
  public onRespawn: ((suspended: string[]) => void) | null = null;

  /** Decides which plugins stay active after a stall (built-ins). */
  public isTrustedPlugin: (hash: string) => boolean = () => false;

  /** Bumped on every respawn; the canvas re-transfers a fresh OffscreenCanvas. */
  public readonly generation = shallowRef(0);

  /** Hashes suspended by the watchdog (cleared via `resumePlugins`). */
  public readonly suspendedPlugins = shallowRef<string[]>([]);

  private worker: Worker | null = null;
  private readyResolve!: () => void;
  private watchdog: Watchdog | null = null;

  // Replay state for respawns.
  private packets = new Map<number, Uint8Array>();
  private modifiersReplay: { packet: Uint8Array; plugins: string[] } | null = null;
  private plugins = new Map<string, Uint8Array>();
  private epoch: number | null = null;
  private canvasState = new Map<string, Record<string, unknown>>();
  private signatureRequest: { requests: Uint32Array; generation: number } | null = null;

  constructor() {
    this.ready = new Promise<void>((resolve) => { this.readyResolve = resolve; });
    if (typeof window !== 'undefined') {
      this.spawn();
      this.watchdog = new Watchdog({ onStall: () => this.respawn() });
      this.watchdog.start();
    }
    else {
      // SSR: resolve immediately, no worker.
      this.readyResolve();
    }
  }

  // ── Worker lifecycle ──────────────────────────

  /** Creates the worker and wires its messages. */
  private spawn(): void {
    const worker = new Worker(new URL('./engine-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; dmx?: Uint8Array; elapsedMs?: number; signatures?: SignatureFrame };
      if (m.type === 'ready') {
        this.readyResolve();
        this.watchdog?.beat();
      }
      else if (m.type === 'frame' && m.dmx && m.elapsedMs !== undefined) {
        this.watchdog?.beat();
        this.dmxBuffer = m.dmx;
        this.onFrame?.(m.dmx, m.elapsedMs, m.signatures);
      }
      else if (m.type === 'plugin-error' || m.type === 'plugin-log') {
        this.onPluginEvent?.(e.data as PluginEvent);
      }
    };
    worker.onerror = e => console.error('[engine-worker] error:', e);
    this.worker = worker;
  }

  /**
   * Terminates a hung worker, starts a new one and replays the state.
   * Non-trusted plugins are suspended (ADR §6.7).
   */
  public respawn(): void {
    if (!this.worker) return;
    console.warn('[engine] worker stalled — respawning');
    this.worker.terminate();
    this.spawn();

    const suspended = [...this.plugins.keys()].filter(h => !this.isTrustedPlugin(h));
    this.suspendedPlugins.value = suspended;
    this.replay();
    this.generation.value++;
    this.onRespawn?.(suspended);
  }

  /** Re-sends everything to a fresh worker. */
  private replay(): void {
    const w = this.worker;
    if (!w) return;
    if (this.epoch !== null) w.postMessage({ type: 'epoch', epoch: this.epoch });
    w.postMessage({ type: 'bpm', bpm: this.globalBpm.value });
    w.postMessage({ type: 'plugins-suspend', hashes: this.suspendedPlugins.value });
    for (const [hash, wasm] of this.plugins) this.postPlugin(hash, wasm);
    for (const [packetType, data] of this.packets) this.postPacket(packetType, data);
    if (this.modifiersReplay) this.postModifiers(this.modifiersReplay.packet, this.modifiersReplay.plugins);
    if (this.signatureRequest) this.worker?.postMessage({ type: 'signatures-request', ...this.signatureRequest });
  }

  /** Re-enables suspended plugins (one action from the UI). */
  public resumePlugins(hashes: string[] = this.suspendedPlugins.value): void {
    this.suspendedPlugins.value = this.suspendedPlugins.value.filter(h => !hashes.includes(h));
    this.worker?.postMessage({ type: 'plugins-suspend', hashes: this.suspendedPlugins.value });
  }

  // ── Packets / tempo / clock ───────────────────

  private postPacket(packetType: number, data: Uint8Array): void {
    const copy = data.slice();
    this.worker?.postMessage({ type: 'dispatch', packetType, data: copy.buffer }, [copy.buffer]);
  }

  /** Dispatches a binary packet payload (cached for respawns). */
  public dispatch(packetType: number, data: Uint8Array): number {
    if (!this.worker) return -1;
    this.packets.set(packetType, data.slice());
    this.postPacket(packetType, data);
    return 0;
  }

  public postBpm(bpm: number): void {
    this.worker?.postMessage({ type: 'bpm', bpm });
  }

  public postEpoch(epoch: number): void {
    this.epoch = epoch;
    this.worker?.postMessage({ type: 'epoch', epoch });
  }

  public reset(): void {
    this.packets.clear();
    this.modifiersReplay = null;
    this.worker?.postMessage({ type: 'reset' });
  }

  // ── Plugins ───────────────────────────────────

  private postPlugin(hash: string, wasm: Uint8Array): void {
    const copy = wasm.slice();
    this.worker?.postMessage({ type: 'plugin-load', hash, wasm: copy.buffer }, [copy.buffer]);
  }

  private postModifiers(packet: Uint8Array, plugins: string[]): void {
    const copy = packet.slice();
    this.worker?.postMessage({ type: 'modifiers-sync', packet: copy.buffer, plugins }, [copy.buffer]);
  }

  /** Loads a plugin module into the worker (idempotent). */
  public loadPlugin(hash: string, wasm: Uint8Array): void {
    if (this.plugins.has(hash)) return;
    this.plugins.set(hash, wasm.slice());
    this.postPlugin(hash, wasm);
  }

  /** Unloads a plugin module. */
  public unloadPlugin(hash: string): void {
    this.plugins.delete(hash);
    this.worker?.postMessage({ type: 'plugin-unload', hash });
  }

  /** True when the plugin module was sent to the worker. */
  public hasPlugin(hash: string): boolean {
    return this.plugins.has(hash);
  }

  /** Sends the modifiers packet with its plugin table (cached for respawns). */
  public syncModifiers(packet: Uint8Array, plugins: string[]): void {
    this.modifiersReplay = { packet: packet.slice(), plugins: plugins.slice() };
    this.postModifiers(packet, plugins);
  }

  // ── Live values ───────────────────────────────

  /**
   * Requests signature tuples for live values: flat (group index,
   * signature id) pairs, echoed with `generation` in frame messages.
   */
  public requestSignatures(requests: Uint32Array, generation: number): void {
    this.signatureRequest = { requests: requests.slice(), generation };
    this.worker?.postMessage({ type: 'signatures-request', requests: requests.slice(), generation });
  }

  // ── Canvas (OffscreenCanvas in worker) ─────────

  /** Sends a canvas message and remembers it for respawn replay. */
  private canvasPost(type: string, payload: Record<string, unknown>): void {
    this.canvasState.set(type, payload);
    this.worker?.postMessage({ type, ...payload });
  }

  /** Transfers an OffscreenCanvas (again after each respawn) and replays canvas state. */
  public initCanvas(offscreen: OffscreenCanvas): void {
    this.worker?.postMessage({ type: 'canvas.init', offscreen }, [offscreen]);
    for (const [type, payload] of this.canvasState) this.worker?.postMessage({ type, ...payload });
  }

  public resizeCanvas(w: number, h: number): void {
    this.canvasPost('canvas.resize', { viewportW: w, viewportH: h });
  }

  public syncCanvasFixtures(json: string): void {
    this.canvasPost('canvas.sync_fixtures', { json });
  }

  public setCanvasCamera(x: number, y: number, scale: number): void {
    this.canvasPost('canvas.set_camera', { cameraX: x, cameraY: y, cameraScale: scale });
  }

  public setCanvasViewport(w: number, h: number): void {
    this.canvasPost('canvas.set_viewport', { viewportW: w, viewportH: h });
  }

  public setCanvasWorld(w: number, h: number): void {
    this.canvasPost('canvas.set_world', { worldW: w, worldH: h });
  }

  public setCanvasMarquee(active: boolean, sx: number, sy: number, ex: number, ey: number): void {
    this.canvasPost('canvas.set_marquee', {
      marqueeActive: active, marqueeSx: sx, marqueeSy: sy, marqueeEx: ex, marqueeEy: ey,
    });
  }

  public setCanvasSelected(ids: Array<string | number>): void {
    this.canvasPost('canvas.set_selected', { ids });
  }

  public setCanvasRemoteSelections(json: string): void {
    this.canvasPost('canvas.set_remote_selections', { json });
  }

  // ── Modifier list ─────────────────────────────

  /** Replaces the modifier list in place (keeps the reactive array identity). */
  public setModifiers(list: ModifierInstance[]): void {
    this.modifiers.splice(0, this.modifiers.length, ...list);
  }

  /** Appends a modifier. */
  public addModifier(m: ModifierInstance): void {
    this.modifiers.push(m);
  }

  /** No-op — the worker renders on its own interval. */
  public render(_timeMs: number, _deltaTimeMs: number): void {}
}

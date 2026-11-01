import initWasm, * as coreModule from 'rs-engine-core';
import { WasmEngine } from 'rs-engine-core';
import wasmUrl from 'rs-engine-core/rs_engine_core_bg.wasm?url';
import initCanvasWasm, * as canvasModule from 'rs-engine-canvas';
import { WasmCanvas } from 'rs-engine-canvas';
import canvasWasmUrl from 'rs-engine-canvas/rs_engine_canvas_bg.wasm?url';
import { WorkerPluginBridge } from '~/utils/plugins/worker-bridge';
import { checkEngineModules, ENGINE_REBUILD_HINT, type EngineFailure } from './engine-abi';

// Modifier plugins run through this bridge (rs-engine-core's JS runtime).
const bridge = new WorkerPluginBridge(event => (self as unknown as Worker).postMessage(event));
bridge.install();

let engine: WasmEngine | null = null;
let canvas: WasmCanvas | null = null;
let canvasReady = false;
let offscreen: OffscreenCanvas | null = null;
/** Base tempo (the music); the speed multiplier is applied in the engine. */
let bpm = 120;
let clockEpoch = Date.now();
let lastTime = Date.now();
let renderHandle: ReturnType<typeof setInterval> | null = null;
// Live-value signature requests: flat (group index, signature id) pairs.
let signatureRequests: Uint32Array = new Uint32Array(0);
let signatureGeneration = 0;
/** Non-fatal failures already reported (each message once). */
const reportedFailures = new Set<string>();

/** Reports a failure to the main thread (fatal ones also stop the engine). */
function reportFailure(failure: EngineFailure): void {
  if (!failure.fatal) {
    if (reportedFailures.has(failure.message)) return;
    reportedFailures.add(failure.message);
  }
  console.error(`[worker] engine ${failure.kind} failure:`, failure.message);
  (self as unknown as Worker).postMessage({ type: 'engine-error', failure });
}

function tick() {
  if (!engine) return;
  try {
    renderFrame(engine);
  }
  catch (e) {
    // Reported once; the watchdog respawns the worker if no frames follow.
    reportFailure({ kind: 'render', message: `Engine render failed: ${String(e)}`, fatal: false });
  }
}

/** Renders one frame, draws the canvas and posts the DMX frame. */
function renderFrame(engine: WasmEngine) {
  try { performance.mark('worker.tick.start'); } catch {}
  const now = Date.now();
  const elapsed = now - clockEpoch;
  const delta = now - lastTime;
  lastTime = now;
  // Tempo changes are recorded on the beat clock at the current clock time.
  engine.set_bpm_at(bpm, elapsed);
  engine.render(elapsed, delta);
  const view = engine.get_dmx_view();
  // Tempo layers of this frame (main thread extrapolates from them):
  // effective beat, base beat (music), speed time and the active multiplier.
  const clock = {
    beatTime: engine.beat_time(elapsed),
    baseBeat: engine.base_beat_time(elapsed),
    speedTimeMs: engine.speed_time(elapsed),
    speed: engine.speed(),
  };

  // Draw directly into the OffscreenCanvas — no main-thread round-trip.
  if (canvasReady && canvas) {
    try { canvas.draw(view, elapsed); } catch (e) { console.error('[worker] canvas.draw failed:', e); }
  }

  // Still send the DMX buffer to main for hardware connectors and UI faders.
  const dmx = new Uint8Array(view.length);
  dmx.set(view);
  if (signatureRequests.length > 0) {
    // Requested signature tuples (3 f32 each) travel with the frame.
    const values = engine.read_signatures(signatureRequests);
    (self as unknown as Worker).postMessage(
      { type: 'frame', dmx, elapsedMs: elapsed, clock, signatures: { generation: signatureGeneration, values } },
      [dmx.buffer, values.buffer],
    );
  }
  else {
    (self as unknown as Worker).postMessage({ type: 'frame', dmx, elapsedMs: elapsed, clock }, [dmx.buffer]);
  }

  try {
    performance.mark('worker.tick.end');
    performance.measure('worker.tick', 'worker.tick.start', 'worker.tick.end');
  } catch {}
}

/**
 * Captures the editor canvas as PNG (agent `screenshot` view "canvas"):
 * draws a fresh frame and encodes it in the same task, before the WebGL
 * drawing buffer is presented and cleared.
 */
function captureCanvas(requestId: number) {
  const reply = (payload: Record<string, unknown>, transfer: Transferable[] = []) =>
    (self as unknown as Worker).postMessage({ type: 'canvas.captured', requestId, ...payload }, transfer);
  if (!canvasReady || !canvas || !offscreen || !engine) {
    reply({ error: 'editor canvas is not initialized' });
    return;
  }
  try {
    canvas.draw(engine.get_dmx_view(), Date.now() - clockEpoch);
    offscreen.convertToBlob({ type: 'image/png' })
      .then(blob => blob.arrayBuffer())
      .then(buffer => reply({ png: buffer }, [buffer]))
      .catch(e => reply({ error: String(e) }));
  }
  catch (e) {
    reply({ error: String(e) });
  }
}

async function init() {
  try {
    // Init both WASM modules in parallel.
    await Promise.all([initWasm({ module_or_path: wasmUrl }), initCanvasWasm({ module_or_path: canvasWasmUrl })]);
  }
  catch (e) {
    reportFailure({ kind: 'load', message: `Engine WASM failed to load: ${String(e)}. ${ENGINE_REBUILD_HINT}`, fatal: true });
    return;
  }
  // Handshake: a stale or foreign build would parse newer packets as empty
  // and render black without any error.
  const mismatch = checkEngineModules(coreModule as unknown as Record<string, unknown>, canvasModule as unknown as Record<string, unknown>);
  if (mismatch) {
    reportFailure({ kind: 'abi', message: `${mismatch} ${ENGINE_REBUILD_HINT}`, fatal: true });
    return;
  }
  engine = new WasmEngine();
  engine.reset_clock(bpm);
  canvas = new WasmCanvas();
  lastTime = Date.now();
  renderHandle = setInterval(tick, 16);
  (self as unknown as Worker).postMessage({ type: 'ready' });
  // Handle everything that arrived during start-up, in order (a respawned
  // worker receives the full replay and the new OffscreenCanvas right away).
  initialized = true;
  for (const e of pending.splice(0)) handleMessage(e);
}

/** Messages received before the WASM modules were ready. */
const pending: MessageEvent[] = [];
let initialized = false;

self.onmessage = (e: MessageEvent) => {
  if (!initialized) pending.push(e);
  else handleMessage(e);
};

/** Handles one message from the main thread (engine ready). */
function handleMessage(e: MessageEvent) {
  const m = e.data as {
    type: string;
    packetType?: number;
    data?: ArrayBuffer;
    bpm?: number;
    epoch?: number;
    tapMs?: number;
    speed?: number;
    // plugin messages
    hash?: string;
    wasm?: ArrayBuffer;
    plugins?: string[];
    packet?: ArrayBuffer;
    hashes?: string[];
    // live-value signature requests
    requests?: Uint32Array;
    generation?: number;
    // canvas messages
    offscreen?: OffscreenCanvas;
    json?: string;
    cameraX?: number; cameraY?: number; cameraScale?: number;
    viewportW?: number; viewportH?: number;
    worldW?: number; worldH?: number;
    marqueeActive?: boolean; marqueeSx?: number; marqueeSy?: number; marqueeEx?: number; marqueeEy?: number;
    ids?: Array<string | number>;
    requestId?: number;
  };
  switch (m.type) {
    case 'dispatch':
      if (engine && m.packetType !== undefined && m.data) {
        if (engine.dispatch(m.packetType, new Uint8Array(m.data)) < 0) {
          // A 0-byte payload is a sender bug (packet never built), not a stale
          // engine build: report it as such instead of a format mismatch.
          const message = m.data.byteLength === 0
            ? `Engine received an empty packet 0x${m.packetType.toString(16)} (packet was never built).`
            : `Engine rejected packet 0x${m.packetType.toString(16)} (format mismatch?). ${ENGINE_REBUILD_HINT}`;
          reportFailure({ kind: 'dispatch', message, fatal: false });
        }
      }
      break;
    case 'bpm':
      if (m.bpm !== undefined) bpm = m.bpm;
      break;
    case 'epoch':
      if (m.epoch !== undefined) {
        clockEpoch = m.epoch;
        lastTime = Date.now();
        // New epoch → the beat clock restarts at the current tempo.
        engine?.reset_clock(bpm);
      }
      break;
    case 'speed':
      // Switches on the next common beat (engine speed layer).
      if (m.speed !== undefined) engine?.request_speed(m.speed, Date.now() - clockEpoch);
      break;
    case 'beat-align':
      // Tap (wall clock) → nudge the beat grid onto it, starting now.
      if (m.tapMs !== undefined) engine?.align_beat(m.tapMs - clockEpoch, Date.now() - clockEpoch);
      break;
    case 'plugin-load':
      if (m.hash && m.wasm) {
        try {
          bridge.load(m.hash, m.wasm);
          engine?.retry_disabled();
        } catch (e) {
          (self as unknown as Worker).postMessage({ type: 'plugin-error', instance: -1, hash: m.hash, message: String(e), reason: 'trap' });
        }
      }
      break;
    case 'plugin-unload':
      if (m.hash) bridge.unload(m.hash);
      break;
    case 'plugins-suspend':
      bridge.setSuspended(m.hashes ?? []);
      engine?.retry_disabled();
      break;
    case 'modifiers-sync':
      if (engine && m.packet) {
        bridge.setTable(m.plugins ?? []);
        if (engine.dispatch(0x16, new Uint8Array(m.packet)) < 0) {
          reportFailure({ kind: 'dispatch', message: `Engine rejected the modifiers packet (format mismatch?). ${ENGINE_REBUILD_HINT}`, fatal: false });
        }
      }
      break;
    case 'signatures-request':
      signatureRequests = m.requests ?? new Uint32Array(0);
      signatureGeneration = m.generation ?? 0;
      break;
    case 'reset':
      if (renderHandle) { clearInterval(renderHandle); renderHandle = null; }
      engine = new WasmEngine();
      engine.reset_clock(bpm);
      lastTime = Date.now();
      renderHandle = setInterval(tick, 16);
      break;
    case 'canvas.init':
      if (canvas && m.offscreen) {
        try {
          offscreen = m.offscreen;
          canvas.init_gl(m.offscreen as unknown as HTMLCanvasElement);
          canvasReady = true;
        } catch (e) {
          console.error('[worker] canvas.init_gl failed:', e);
        }
      }
      break;
    case 'canvas.resize':
      if (offscreen && m.viewportW !== undefined && m.viewportH !== undefined) {
        offscreen.width = m.viewportW;
        offscreen.height = m.viewportH;
      }
      break;
    case 'canvas.sync_fixtures':
      if (canvas && m.json !== undefined) {
        try { canvas.sync_fixtures(m.json); } catch (e) { console.error('[worker] sync_fixtures:', e); }
      }
      break;
    case 'canvas.set_camera':
      if (canvas && m.cameraX !== undefined) {
        canvas.set_camera(m.cameraX, m.cameraY!, m.cameraScale!);
      }
      break;
    case 'canvas.set_viewport':
      if (canvas && m.viewportW !== undefined) {
        canvas.set_viewport(m.viewportW, m.viewportH!);
      }
      break;
    case 'canvas.set_world':
      if (canvas && m.worldW !== undefined) {
        canvas.set_world(m.worldW, m.worldH!);
      }
      break;
    case 'canvas.set_marquee':
      if (canvas) {
        canvas.set_marquee(m.marqueeActive!, m.marqueeSx!, m.marqueeSy!, m.marqueeEx!, m.marqueeEy!);
      }
      break;
    case 'canvas.set_selected':
      if (canvas && m.ids) {
        canvas.set_selected(m.ids);
      }
      break;
    case 'canvas.capture':
      captureCanvas(m.requestId ?? 0);
      break;
    case 'canvas.set_remote_selections':
      if (canvas && m.json !== undefined) {
        canvas.set_remote_selections(m.json);
      }
      break;
  }
}

init();

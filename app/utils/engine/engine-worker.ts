import initWasm, { WasmEngine } from 'rs-engine-core';
import wasmUrl from 'rs-engine-core/rs_engine_core_bg.wasm?url';
import initCanvasWasm, { WasmCanvas } from 'rs-engine-canvas';
import canvasWasmUrl from 'rs-engine-canvas/rs_engine_canvas_bg.wasm?url';
import { WorkerPluginBridge } from '~/utils/plugins/worker-bridge';

// Modifier plugins run through this bridge (rs-engine-core's JS runtime).
const bridge = new WorkerPluginBridge(event => (self as unknown as Worker).postMessage(event));
bridge.install();

let engine: WasmEngine | null = null;
let canvas: WasmCanvas | null = null;
let canvasReady = false;
let offscreen: OffscreenCanvas | null = null;
let bpm = 120;
let clockEpoch = Date.now();
let lastTime = Date.now();
let renderHandle: ReturnType<typeof setInterval> | null = null;
// Live-value signature requests: flat (group index, signature id) pairs.
let signatureRequests: Uint32Array = new Uint32Array(0);
let signatureGeneration = 0;

function tick() {
  if (!engine) return;
  try { performance.mark('worker.tick.start'); } catch {}
  const now = Date.now();
  const elapsed = now - clockEpoch;
  const delta = now - lastTime;
  lastTime = now;
  // Tempo changes are recorded on the beat clock at the current clock time.
  engine.set_bpm_at(bpm, elapsed);
  engine.render(elapsed, delta);
  const view = engine.get_dmx_view();

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
      { type: 'frame', dmx, elapsedMs: elapsed, signatures: { generation: signatureGeneration, values } },
      [dmx.buffer, values.buffer],
    );
  }
  else {
    (self as unknown as Worker).postMessage({ type: 'frame', dmx, elapsedMs: elapsed }, [dmx.buffer]);
  }

  try {
    performance.mark('worker.tick.end');
    performance.measure('worker.tick', 'worker.tick.start', 'worker.tick.end');
  } catch {}
}

async function init() {
  // Init both WASM modules in parallel.
  await Promise.all([initWasm({ module_or_path: wasmUrl }), initCanvasWasm({ module_or_path: canvasWasmUrl })]);
  engine = new WasmEngine();
  engine.reset_clock(bpm);
  canvas = new WasmCanvas();
  lastTime = Date.now();
  renderHandle = setInterval(tick, 16);
  (self as unknown as Worker).postMessage({ type: 'ready' });
}

self.onmessage = (e: MessageEvent) => {
  const m = e.data as {
    type: string;
    packetType?: number;
    data?: ArrayBuffer;
    bpm?: number;
    epoch?: number;
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
  };
  switch (m.type) {
    case 'dispatch':
      if (engine && m.packetType !== undefined && m.data) {
        engine.dispatch(m.packetType, new Uint8Array(m.data));
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
        engine.dispatch(0x16, new Uint8Array(m.packet));
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
    case 'canvas.set_remote_selections':
      if (canvas && m.json !== undefined) {
        canvas.set_remote_selections(m.json);
      }
      break;
  }
};

init();

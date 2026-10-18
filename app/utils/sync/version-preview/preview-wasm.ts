import initWasm, { WasmCanvas } from 'rs-engine-canvas';
import wasmUrl from 'rs-engine-canvas/rs_engine_canvas_bg.wasm?url';
import { toCanvasPayload } from '~/utils/sync/version-preview/preview-canvas-data';
import { fitCamera, PREVIEW_WORLD, type PreviewModel } from '~/utils/sync/version-preview/preview-model';

/**
 * Renders a hover preview with the workspace renderer (`rs-engine-canvas`,
 * femtovg/WebGL) on the MAIN thread — no engine, no worker: one hidden
 * WebGL canvas and one `WasmCanvas` are created lazily and reused for every
 * preview (browsers cap live WebGL contexts). Each render syncs the preview
 * fixtures, sets the camera, draws ONE frame with a synthetic DMX buffer and
 * copies it into the visible 2D canvas in the same task (the WebGL drawing
 * buffer is still valid before compositing). Group outlines are stroked on
 * top in 2D. The WASM module is the one `FixtureCanvas.vue` already loads for
 * hit-testing (init is idempotent).
 *
 * Loaded with a dynamic `import()` so tests and the SVG fallback never pull it in.
 */

interface GlRenderer {
  el: HTMLCanvasElement;
  canvas: WasmCanvas;
}

/** Shared renderer; `false` after a failed init (→ SVG fallback for the session). */
let renderer: Promise<GlRenderer | false> | null = null;

/** Creates the shared WebGL renderer once. */
function getRenderer(): Promise<GlRenderer | false> {
  renderer ??= (async () => {
    try {
      await initWasm({ module_or_path: wasmUrl });
      const el = document.createElement('canvas');
      el.width = 2;
      el.height = 2;
      const canvas = new WasmCanvas();
      canvas.init_gl(el);
      canvas.set_world(PREVIEW_WORLD, PREVIEW_WORLD);
      return { el, canvas };
    }
    catch (err) {
      console.warn('[version-preview] WebGL preview unavailable, using SVG:', err);
      return false;
    }
  })();
  return renderer;
}

/**
 * Creates the renderer ahead of time (first hover, during the 300 ms delay),
 * so the one-time WASM/WebGL/font setup is not part of the first preview.
 */
export function warmWasmPreview(): void {
  void getRenderer();
}

/** Outline color of groups (workspace muted foreground). */
const OUTLINE = 'rgba(255,255,255,0.28)';

/**
 * Draws `model` into `target` (CSS size `width × height`, device pixels via
 * `dpr`). Returns the render time in ms (sync + draw + copy), or null when
 * the WebGL renderer is unavailable — the caller then shows the SVG.
 */
export async function renderWasmPreview(target: HTMLCanvasElement, model: PreviewModel, width: number, height: number, dpr = 1): Promise<number | null> {
  const r = await getRenderer();
  if (!r) return null;
  const ctx = target.getContext('2d');
  if (!ctx) return null;

  const t0 = performance.now();
  const pw = Math.max(1, Math.round(width * dpr));
  const ph = Math.max(1, Math.round(height * dpr));
  const cam = fitCamera(model.bounds, width, height);
  try {
    if (r.el.width !== pw || r.el.height !== ph) { r.el.width = pw; r.el.height = ph; }
    const payload = toCanvasPayload(model);
    r.canvas.sync_fixtures(JSON.stringify(payload.fixtures));
    r.canvas.set_viewport(pw, ph);
    r.canvas.set_camera(cam.x * dpr, cam.y * dpr, cam.scale * dpr);
    r.canvas.set_marquee(false, 0, 0, 0, 0);
    r.canvas.draw(payload.dmx, 0);

    target.width = pw;
    target.height = ph;
    ctx.clearRect(0, 0, pw, ph);
    ctx.drawImage(r.el, 0, 0);
  }
  catch (err) {
    console.warn('[version-preview] WebGL preview failed, using SVG:', err);
    renderer = Promise.resolve(false);
    return null;
  }

  // Group outlines (dashed, 1 px) in screen space.
  if (model.groups.length) {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    for (const g of model.groups) {
      ctx.strokeRect(
        g.box.minX * cam.scale + cam.x,
        g.box.minY * cam.scale + cam.y,
        (g.box.maxX - g.box.minX) * cam.scale,
        (g.box.maxY - g.box.minY) * cam.scale,
      );
    }
    ctx.restore();
  }
  return performance.now() - t0;
}

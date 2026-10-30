/**
 * `screenshot` implementation of the app agent host (WP-K, ADR 0002 §5):
 * - `layout`: stage model → draw commands → PNG (works on any page);
 * - `canvas`: frame of the mounted 2D editor canvas (engine worker).
 * 3D view captures are not implemented yet.
 */
import { SCREENSHOT_DEFAULT_SIZE, type ScreenshotRequest, type ScreenshotResult } from '@pixelmapper/agent-kit';
import type { Fixture } from '~/utils/engine/core/fixture';
import { orientationFromPoints } from '~/utils/operations/core/orientation';
import { canvasRasterizer, compositeCapture, type RasterImage, type Rasterizer } from './canvas-backend';
import { editorCanvasCapture, type EditorCanvasCapture } from './editor-canvas';
import { buildLayoutScene, layoutOptions, type LayoutScene } from './layout-scene';
import { buildStageModel, type StageModel } from './stage-model';

export { buildLayoutScene, layoutOptions } from './layout-scene';
export { buildStageModel } from './stage-model';
export { registerEditorCanvas } from './editor-canvas';

// ── Dependencies ────────────────────────────────

/** What the screenshot service reads (defaults: engine store, live engine frame). */
export interface ScreenshotDeps {
  /** Fixtures in layout order. */
  fixtures(): readonly Fixture[];
  /** Latest output frame, or null when the engine is not producing frames. */
  dmx(): Uint8Array | null;
  /** Layout rasterizer (default OffscreenCanvas). */
  rasterize?: Rasterizer;
  /** Editor canvas capture (default: the registered `FixtureCanvas`). */
  editorCanvas?(): EditorCanvasCapture | null;
}

/** Message when the editor canvas is not mounted. */
export const CANVAS_UNAVAILABLE = 'The 2D editor canvas is not open (the user is on another page, or the editor is hidden), so there is nothing to capture. Use view "layout" — it renders the same stage from the project model.';

/** Background the editor canvas is composited onto (matches the editor). */
const EDITOR_BACKGROUND = '#0a0a0a';

/** Longest fixture list in the caption. */
const MAX_CAPTION_FIXTURES = 40;

// ── Caption ─────────────────────────────────────

/** One caption line per fixture: name, id, rotation and head direction. */
function fixtureLine(f: StageModel['fixtures'][number]): string {
  const o = orientationFromPoints(f.heads);
  const dir = o ? `${f.heads.length} heads run ${o.runs}` : `${f.heads.length} head`;
  return `- "${f.name}" (${f.id}) at ${f.center.x.toFixed(3)}, ${f.center.y.toFixed(3)} · rotation ${Number(f.rotation.toFixed(1))}° · ${dir}`;
}

/** Caption of a layout render. */
export function layoutCaption(model: StageModel, scene: LayoutScene, highlight: number): string {
  const r = scene.region;
  const lines = [
    `Layout view (schematic top view from the project model) · ${scene.width}×${scene.height} px · region x ${r.minX.toFixed(3)}–${r.maxX.toFixed(3)}, y ${r.minY.toFixed(3)}–${r.maxY.toFixed(3)} · ${scene.shown} of ${model.fixtures.length} fixtures shown${highlight ? ` · ${highlight} highlighted` : ''}.`,
    `Legend: outlines = fixture footprints at their rotation; dots = heads at their world positions, ${model.colors === 'live' ? 'filled with the current output color (dark = off)' : 'grey (no live output available)'}; yellow ring = head 0; yellow arrow = head 0 → last head (patch direction); dashed box = room box. x grows to the right, y grows downward.`,
  ];
  const shown = model.fixtures.slice(0, MAX_CAPTION_FIXTURES).map(fixtureLine);
  if (shown.length) lines.push('Fixtures:', ...shown);
  if (model.fixtures.length > MAX_CAPTION_FIXTURES) lines.push(`… and ${model.fixtures.length - MAX_CAPTION_FIXTURES} more (use inspect for the rest).`);
  return lines.join('\n');
}

// ── Service ─────────────────────────────────────

/** Renders the layout view into a scene (pure; exported for tests). */
export function renderLayoutScene(model: StageModel, request: ScreenshotRequest): LayoutScene {
  return buildLayoutScene(model, layoutOptions(model, request));
}

/** Captures the editor canvas. */
async function captureCanvas(deps: ScreenshotDeps, request: ScreenshotRequest): Promise<ScreenshotResult> {
  const capture = (deps.editorCanvas ?? editorCanvasCapture)();
  if (!capture) throw new Error(CANVAS_UNAVAILABLE);
  const frame = await capture();
  const image: RasterImage = await compositeCapture(frame, EDITOR_BACKGROUND, request.size ?? SCREENSHOT_DEFAULT_SIZE);
  return {
    ...image,
    mimeType: 'image/png',
    caption: `Editor canvas capture (what the user sees in the 2D editor: current camera, selection and live colors; HTML overlays such as modifier handles are not included) · ${image.width}×${image.height} px.`,
  };
}

/** Takes a screenshot. */
export async function takeScreenshot(request: ScreenshotRequest, deps: ScreenshotDeps): Promise<ScreenshotResult> {
  if (request.view === 'canvas') return captureCanvas(deps, request);
  const model = buildStageModel(deps.fixtures(), deps.dmx());
  const scene = renderLayoutScene(model, request);
  const image = await (deps.rasterize ?? canvasRasterizer)(scene);
  return { ...image, mimeType: 'image/png', caption: layoutCaption(model, scene, request.highlight?.length ?? 0) };
}

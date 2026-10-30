/**
 * OffscreenCanvas backend of the `screenshot` tool (WP-K): replays draw
 * commands into a PNG, and composites editor-canvas captures (transparent
 * WebGL frames) onto the editor background. Browser only; tests inject
 * their own rasterizer.
 */
import type { DrawCommand, DrawScene } from './draw-commands';

/** A PNG ready for MCP image content. */
export interface RasterImage {
  /** Base64 PNG (no `data:` prefix). */
  data: string;
  width: number;
  height: number;
}

/** Rasterizes a scene. */
export type Rasterizer = (scene: DrawScene) => Promise<RasterImage>;

/** Font stack of the labels. */
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

// ── Encoding ────────────────────────────────────

/** Base64 of a blob (chunked to stay below argument limits). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** New 2D OffscreenCanvas, or a readable error when unsupported. */
function offscreen(width: number, height: number): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } {
  if (typeof OffscreenCanvas === 'undefined') throw new Error('rendering needs OffscreenCanvas, which this environment lacks');
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('could not create a 2D canvas context');
  return { canvas, ctx };
}

// ── Replay ──────────────────────────────────────

/** Applies fill / stroke of a shape command to the current path. */
function paint(ctx: OffscreenCanvasRenderingContext2D, c: { fill?: string; stroke?: string; lineWidth?: number; dash?: number[] }): void {
  if (c.fill) {
    ctx.fillStyle = c.fill;
    ctx.fill();
  }
  if (c.stroke) {
    ctx.strokeStyle = c.stroke;
    ctx.lineWidth = c.lineWidth ?? 1;
    ctx.setLineDash(c.dash ?? []);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** Draws one command. */
function drawCommand(ctx: OffscreenCanvasRenderingContext2D, c: DrawCommand): void {
  switch (c.op) {
    case 'rect':
      ctx.beginPath();
      ctx.rect(c.x, c.y, c.w, c.h);
      paint(ctx, c);
      break;
    case 'poly':
      ctx.beginPath();
      for (let i = 0; i + 1 < c.points.length; i += 2) {
        if (i === 0) ctx.moveTo(c.points[i]!, c.points[i + 1]!);
        else ctx.lineTo(c.points[i]!, c.points[i + 1]!);
      }
      if (c.closed) ctx.closePath();
      paint(ctx, c);
      break;
    case 'circle':
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      paint(ctx, c);
      break;
    case 'clip':
      ctx.save();
      ctx.beginPath();
      ctx.rect(c.x, c.y, c.w, c.h);
      ctx.clip();
      break;
    case 'unclip':
      ctx.restore();
      break;
    case 'text':
      ctx.font = `${c.bold ? '600 ' : ''}${c.size}px ${FONT}`;
      ctx.textAlign = c.align;
      ctx.textBaseline = c.baseline;
      if (c.halo) {
        ctx.strokeStyle = c.halo;
        ctx.lineWidth = Math.max(2, c.size / 4);
        ctx.lineJoin = 'round';
        ctx.strokeText(c.text, c.x, c.y);
      }
      ctx.fillStyle = c.color;
      ctx.fillText(c.text, c.x, c.y);
      break;
  }
}

/** Default rasterizer: replays the scene on an OffscreenCanvas and encodes PNG. */
export const canvasRasterizer: Rasterizer = async (scene) => {
  const { canvas, ctx } = offscreen(scene.width, scene.height);
  ctx.fillStyle = scene.background;
  ctx.fillRect(0, 0, scene.width, scene.height);
  for (const c of scene.commands) drawCommand(ctx, c);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { data: await blobToBase64(blob), width: scene.width, height: scene.height };
};

// ── Editor capture ──────────────────────────────

/**
 * Composites a captured editor frame onto `background` (the WebGL canvas is
 * transparent and blended over the page) and scales it so the longer side
 * is at most `maxSize`.
 */
export async function compositeCapture(frame: Blob, background: string, maxSize: number): Promise<RasterImage> {
  const bitmap = await createImageBitmap(frame);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const { canvas, ctx } = offscreen(width, height);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { data: await blobToBase64(blob), width, height };
}

/**
 * Screenshot request / result (ADR 0002 §5: the opt-in eighth tool for
 * visual-only questions; never a replacement for `observe`).
 *
 * Only the contract lives here; rendering is host-side
 * (`app/utils/agents/screenshot`). Views:
 * - `layout`: schematic stage render generated from the project model
 *   (works on any page and headless);
 * - `canvas`: capture of the 2D editor canvas as the user sees it.
 */
import { z } from 'zod';

// ── Request ─────────────────────────────────────

/** Largest accepted image side in pixels. */
export const SCREENSHOT_MAX_SIZE = 2048;

/** Default image side (longer edge) in pixels. */
export const SCREENSHOT_DEFAULT_SIZE = 1024;

/** A normalized world rectangle (0–1 like fixture x/y). */
export const ScreenshotRegionSchema = z.object({
  minX: z.number(),
  minY: z.number(),
  maxX: z.number(),
  maxY: z.number(),
}).refine(r => r.maxX > r.minX && r.maxY > r.minY, { message: 'region needs maxX > minX and maxY > minY' });

/** Zod schema of the screenshot request. */
export const ScreenshotRequestSchema = z.object({
  view: z.enum(['layout', 'canvas']).optional()
    .describe('"layout" (default): schematic render of the project model. "canvas": capture of the 2D editor canvas as the user sees it (needs the editor page open).'),
  labels: z.enum(['name', 'id', 'none']).optional()
    .describe('layout: fixture labels (default "name").'),
  highlight: z.array(z.union([z.string(), z.number()])).optional()
    .describe('layout: fixture ids drawn with an accent outline.'),
  region: z.union([z.literal('fit'), z.literal('world'), ScreenshotRegionSchema]).optional()
    .describe('layout: "fit" (default, all fixtures plus margin), "world" (the full 0–1 world) or a normalized rectangle { minX, minY, maxX, maxY } to zoom.'),
  size: z.number().int().min(128).max(SCREENSHOT_MAX_SIZE).optional()
    .describe(`Longer image side in pixels (default ${SCREENSHOT_DEFAULT_SIZE}, max ${SCREENSHOT_MAX_SIZE}).`),
});

/** Screenshot request. */
export type ScreenshotRequest = z.infer<typeof ScreenshotRequestSchema>;

// ── Result ──────────────────────────────────────

/** A rendered screenshot. */
export interface ScreenshotResult {
  /** Base64 image data (no `data:` prefix). */
  data: string;
  /** e.g. `image/png`. */
  mimeType: string;
  width: number;
  height: number;
  /** Short text that tells the model what the image shows (legend, region, colors). */
  caption: string;
}

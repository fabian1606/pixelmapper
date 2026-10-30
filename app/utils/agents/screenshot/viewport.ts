/**
 * Region and pixel mapping of the `screenshot` layout view (WP-K): which
 * part of the normalized world is shown, the image size, and the axis
 * tick positions.
 */
import type { ScreenshotRequest } from '@pixelmapper/agent-kit';
import type { StageModel, StagePoint } from './stage-model';

// ── Types ───────────────────────────────────────

/** A normalized world rectangle. */
export interface Region {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Image margins in px (room for tick labels and the legend). */
export interface Margins {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Mapping from world to image pixels. */
export interface Viewport {
  region: Region;
  width: number;
  height: number;
  margins: Margins;
  /** Image px per world unit (same on both axes). */
  scale: number;
  /** World → image px. */
  toPx(p: StagePoint): { x: number; y: number };
}

/** Smallest world span shown on either axis. */
const MIN_SPAN = 0.05;
/** Largest aspect ratio of the shown region (thin rows get extra space). */
const MAX_ASPECT = 3;
/** Padding around "fit" regions, as a fraction of the larger span. */
const FIT_PADDING = 0.08;

// ── Region ──────────────────────────────────────

/** Bounding box of every outline point and head (null without fixtures). */
export function contentBounds(model: StageModel): Region | null {
  let r: Region | null = null;
  for (const f of model.fixtures) {
    for (const p of [...f.outline, ...f.heads]) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      r = r
        ? { minX: Math.min(r.minX, p.x), minY: Math.min(r.minY, p.y), maxX: Math.max(r.maxX, p.x), maxY: Math.max(r.maxY, p.y) }
        : { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
    }
  }
  return r;
}

/** Grows a region around its center to the minimum span and maximum aspect. */
function normalizeRegion(r: Region): Region {
  let w = Math.max(r.maxX - r.minX, MIN_SPAN);
  let h = Math.max(r.maxY - r.minY, MIN_SPAN);
  if (w / h > MAX_ASPECT) h = w / MAX_ASPECT;
  if (h / w > MAX_ASPECT) w = h / MAX_ASPECT;
  const cx = (r.minX + r.maxX) / 2;
  const cy = (r.minY + r.maxY) / 2;
  return { minX: cx - w / 2, minY: cy - h / 2, maxX: cx + w / 2, maxY: cy + h / 2 };
}

/** Region shown for a request (`fit` = content + padding; `world` = 0–1). */
export function resolveRegion(model: StageModel, region: ScreenshotRequest['region']): Region {
  if (region === 'world') return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  if (region && typeof region === 'object') return normalizeRegion(region);
  const bounds = contentBounds(model);
  if (!bounds) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const pad = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, MIN_SPAN) * FIT_PADDING;
  return normalizeRegion({ minX: bounds.minX - pad, minY: bounds.minY - pad, maxX: bounds.maxX + pad, maxY: bounds.maxY + pad });
}

// ── Viewport ────────────────────────────────────

/** Scale of UI elements (fonts, margins, strokes): relative to 1024 px, never below 0.75 so labels stay legible. */
export function uiScale(size: number): number {
  return Math.max(0.75, size / 1024);
}

/** Builds the viewport: the longer image side is `size` px. */
export function createViewport(region: Region, size: number): Viewport {
  const k = uiScale(size);
  const margins: Margins = { left: Math.round(52 * k), top: Math.round(30 * k), right: Math.round(16 * k), bottom: Math.round(30 * k) };
  const w = region.maxX - region.minX;
  const h = region.maxY - region.minY;
  const plotLong = size - (w >= h ? margins.left + margins.right : margins.top + margins.bottom);
  const scale = plotLong / Math.max(w, h);
  const width = Math.round(w * scale) + margins.left + margins.right;
  const height = Math.round(h * scale) + margins.top + margins.bottom;
  return {
    region,
    width,
    height,
    margins,
    scale,
    toPx: p => ({ x: margins.left + (p.x - region.minX) * scale, y: margins.top + (p.y - region.minY) * scale }),
  };
}

// ── Ticks ───────────────────────────────────────

/** Candidate tick steps in world units. */
const STEPS = [0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5];

/** Tick values inside [min, max] with ~6–10 ticks. */
export function ticks(min: number, max: number): { step: number; values: number[] } {
  const span = max - min;
  const step = STEPS.find(s => span / s <= 10) ?? 0.5;
  const values: number[] = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) values.push(Math.round(v * 1000) / 1000);
  return { step, values };
}

/** Tick label with as many decimals as the step needs. */
export function tickLabel(v: number, step: number): string {
  // Decimals of the step itself (0.25 → 2, 0.1 → 1, 0.025 → 3).
  const decimals = Math.min(3, (String(step).split('.')[1] ?? '').length);
  return v.toFixed(decimals);
}

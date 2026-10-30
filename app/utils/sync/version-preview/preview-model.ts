import { PREVIEW_SHAPE, type PreviewFixture, type SnapshotLayout } from '~/utils/sync/remote-api-snapshot-preview';

/**
 * Pure geometry of a version-history hover preview: places the fixtures of a
 * `SnapshotLayout` in world pixels with the same extents as the workspace
 * canvas (rs-engine-canvas `render.rs`), computes group outlines and the
 * camera that fits everything into the preview viewport. Shared by the WASM
 * renderer (`preview-wasm.ts`) and the SVG fallback (`preview-svg.ts`).
 */

// ── Constants (mirror the workspace canvas) ──────────────────────────────────

/** World size in px (`utils/engine/constants.ts`, rs-engine-canvas default). */
export const PREVIEW_WORLD = 3000;
/** Single-beam fixtures: ellipse radii `16 × size` (render.rs). */
const SINGLE_RADIUS = 16;
/** Multi-beam / kind fixtures: half extents `18 × size` (render.rs). */
const BAR_HALF = 18;
/** Padding around group outlines in world px. */
const GROUP_PAD = 14;
/** Color of fixtures without a single base color (multi-color / no color channel). */
export const NEUTRAL_COLOR = '#e4e4e7';
/** Max zoom: a lone fixture must not fill the whole preview. */
const MAX_SCALE = 3;

// ── Types ────────────────────────────────────────────────────────────────────

/** Axis-aligned box in world px. */
export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** One fixture in world px. */
export interface PlacedFixture {
  /** Center. */
  cx: number;
  cy: number;
  /** Half extents before rotation. */
  hw: number;
  hh: number;
  /** Degrees. */
  rotation: number;
  color: string;
  shape: PreviewFixture['shape'];
  /** Pixel dots of multi-beam fixtures, local offsets from the center (unrotated). */
  dots: Array<{ x: number; y: number }>;
  dotRadius: number;
  group: number;
}

export interface GroupOutline {
  name: string;
  box: Box;
}

/** World → viewport transform: `screen = world × scale + offset`. */
export interface PreviewCamera {
  x: number;
  y: number;
  scale: number;
}

export interface PreviewModel {
  fixtures: PlacedFixture[];
  groups: GroupOutline[];
  /** Bounds of everything (null = empty project). */
  bounds: Box | null;
  /** Fixtures in the snapshot that are not drawn (server cap). */
  hidden: number;
}

// ── Model ────────────────────────────────────────────────────────────────────

/** Places the fixtures of `layout` and derives group outlines. */
export function buildPreviewModel(layout: SnapshotLayout): PreviewModel {
  const fixtures = layout.fixtures.map(placeFixture);
  const groupBoxes = new Map<number, Box>();
  let bounds: Box | null = null;
  for (const f of fixtures) {
    const box = fixtureBox(f);
    bounds = union(bounds, box);
    if (f.group >= 0) groupBoxes.set(f.group, union(groupBoxes.get(f.group) ?? null, box));
  }
  const groups: GroupOutline[] = [...groupBoxes.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, box]) => ({ name: layout.groups[index] ?? '', box: pad(box, GROUP_PAD) }));
  for (const g of groups) bounds = union(bounds, g.box);
  return { fixtures, groups, bounds, hidden: Math.max(0, layout.total - layout.fixtures.length) };
}

/** World placement of one fixture (extents like render.rs). */
export function placeFixture(f: PreviewFixture): PlacedFixture {
  const single = f.shape === PREVIEW_SHAPE.single;
  const hw = (single ? SINGLE_RADIUS : BAR_HALF) * f.w;
  const hh = (single ? SINGLE_RADIUS : BAR_HALF) * f.h;
  const grid = f.shape === PREVIEW_SHAPE.multi ? beamGrid(f.beams, f.w, f.h) : { dots: [], radius: 0 };
  return {
    cx: f.x * PREVIEW_WORLD,
    cy: f.y * PREVIEW_WORLD,
    hw,
    hh,
    rotation: f.r,
    color: f.color ?? NEUTRAL_COLOR,
    shape: f.shape,
    dots: grid.dots.map(d => ({ x: d.x * hw * 2, y: d.y * hh * 2 })),
    dotRadius: grid.radius,
    group: f.group,
  };
}

/**
 * Pixel grid of a multi-beam fixture: local positions in −0.5…0.5 (like the
 * beams' `localX/localY`) and the dot radius in world px (render.rs: 80 % of
 * half the smaller slot).
 */
export function beamGrid(beams: number, w: number, h: number): { dots: Array<{ x: number; y: number }>; radius: number } {
  const n = Math.max(1, Math.floor(beams));
  const aspect = (w > 0 && h > 0) ? w / h : 1;
  const cols = Math.min(n, Math.max(1, Math.round(Math.sqrt(n * aspect))));
  const rows = Math.ceil(n / cols);
  const dots: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    dots.push({ x: (i % cols + 0.5) / cols - 0.5, y: (Math.floor(i / cols) + 0.5) / rows - 0.5 });
  }
  const slotW = (BAR_HALF * w * 2) / cols;
  const slotH = (BAR_HALF * h * 2) / rows;
  return { dots, radius: Math.max(1.5, Math.min(slotW, slotH) / 2 * 0.8) };
}

/** Rotated bounding box of a placed fixture. */
export function fixtureBox(f: PlacedFixture): Box {
  const rad = (f.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const ex = f.hw * cos + f.hh * sin;
  const ey = f.hw * sin + f.hh * cos;
  return { minX: f.cx - ex, minY: f.cy - ey, maxX: f.cx + ex, maxY: f.cy + ey };
}

// ── Camera ───────────────────────────────────────────────────────────────────

/**
 * Camera that fits `bounds` into a `width × height` viewport with `padding`
 * px on each side, centered. Empty bounds show the world center.
 */
export function fitCamera(bounds: Box | null, width: number, height: number, padding = 12): PreviewCamera {
  const b = bounds ?? { minX: PREVIEW_WORLD / 2 - 100, minY: PREVIEW_WORLD / 2 - 100, maxX: PREVIEW_WORLD / 2 + 100, maxY: PREVIEW_WORLD / 2 + 100 };
  const bw = Math.max(b.maxX - b.minX, 1);
  const bh = Math.max(b.maxY - b.minY, 1);
  const scale = Math.min(Math.max(width - padding * 2, 1) / bw, Math.max(height - padding * 2, 1) / bh, MAX_SCALE);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return { x: width / 2 - cx * scale, y: height / 2 - cy * scale, scale };
}

// ── Box helpers ──────────────────────────────────────────────────────────────

function union(a: Box | null, b: Box): Box {
  if (!a) return { ...b };
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

function pad(b: Box, p: number): Box {
  return { minX: b.minX - p, minY: b.minY - p, maxX: b.maxX + p, maxY: b.maxY + p };
}

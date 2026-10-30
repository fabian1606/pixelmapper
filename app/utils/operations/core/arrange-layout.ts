/**
 * Pure layout geometry of `fixtures.arrange` (no store access).
 *
 * Space: normalized world 0–1, x left→right, y top→bottom on the 2D canvas
 * (y-down). Angles are degrees, clockwise on the canvas, 0° = +x (right),
 * 90° = +y (down) — the same convention as fixture `rotation`.
 *
 * Each layout maps fixtures (already in arrange order) to target points and
 * the direction of the layout at each point (`along`, degrees): the row
 * direction of a grid, the line direction, the circle tangent (clockwise
 * travel), the distribute axis or the aligned edge. `fixtures.arrange` turns
 * `along` into rotations for `orient`.
 */
import { z } from 'zod';
import { Unit } from './shared';

// ── Schemas ─────────────────────────────────────

/** A normalized point. */
const PointSchema = z.object({ x: Unit, y: Unit });

/** Normalized rectangle. */
const BoundsSchema = z.object({ minX: Unit, minY: Unit, maxX: Unit, maxY: Unit });

/** Grid layout. */
const GridSchema = z.object({
  type: z.literal('grid'),
  rows: z.number().int().positive().optional().describe('Row count (default: from cols, else auto ≈ square).'),
  cols: z.number().int().positive().optional().describe('Fixtures per row (default: ceil(count / rows)).'),
  bounds: BoundsSchema.optional().describe('Rectangle the grid fills edge to edge: first/last column on minX/maxX, first/last row on minY/maxY (default: the fixtures\' current bounding box). A single row/column sits on the center line.'),
  gap: z.object({ x: z.number().positive().optional(), y: z.number().positive().optional() }).optional()
    .describe('Fixed spacing between columns (x) / rows (y) instead of filling the bounds; the grid is then centered in the bounds.'),
}).describe('Rows top→bottom, each row left→right; a shorter last row is centered.');

/** Line layout. */
const LineSchema = z.object({
  type: z.literal('line'),
  from: PointSchema,
  to: PointSchema,
}).describe('Evenly spaced from `from` to `to` (both ends included).');

/** Circle / arc layout. */
const CircleSchema = z.object({
  type: z.enum(['circle', 'arc']),
  center: PointSchema,
  radius: z.number().positive().describe('Normalized like x/y.'),
  startAngle: z.number().optional().describe('Degrees, 0 = right (+x), 90 = down (+y), clockwise. Default 0.'),
  endAngle: z.number().optional().describe('Degrees. Default startAngle + 360 (full circle, evenly spaced, no duplicate end point); a partial arc includes both ends.'),
}).describe('Clockwise from startAngle to endAngle.');

/** Distribute layout. */
const DistributeSchema = z.object({
  type: z.literal('distribute'),
  axis: z.enum(['x', 'y']),
  from: Unit.optional().describe('First position on the axis (default: current minimum).'),
  to: Unit.optional().describe('Last position on the axis (default: current maximum).'),
}).describe('Even spacing along one axis; the other coordinate is kept.');

/** Align layout. */
const AlignSchema = z.object({
  type: z.literal('align'),
  edge: z.enum(['left', 'right', 'top', 'bottom', 'centerX', 'centerY']),
  value: Unit.optional().describe('Target coordinate (default: the edge / center of the fixtures\' current bounding box).'),
}).describe('left/right/centerX set x, top/bottom/centerY set y; the other coordinate is kept.');

/** Any layout. */
export const LayoutSchema = z.discriminatedUnion('type', [GridSchema, LineSchema, CircleSchema, DistributeSchema, AlignSchema]);

/** Layout input type. */
export type Layout = z.infer<typeof LayoutSchema>;

// ── Types ───────────────────────────────────────

/** A fixture as the layout sees it (current position). */
export interface LayoutItem { id: string | number; x: number; y: number }

/** Target of one fixture. */
export interface LayoutTarget {
  id: string | number;
  x: number;
  y: number;
  /** Layout direction at this point in degrees (canvas convention). */
  along: number;
}

// ── Helpers ─────────────────────────────────────

/** Degrees → radians. */
const RAD = Math.PI / 180;

/** Rounds away float noise (positions are compared with ε later). */
function round(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/** Bounding box of items. */
export function extentOf(items: readonly LayoutItem[]): z.infer<typeof BoundsSchema> {
  return {
    minX: Math.min(...items.map(i => i.x)), maxX: Math.max(...items.map(i => i.x)),
    minY: Math.min(...items.map(i => i.y)), maxY: Math.max(...items.map(i => i.y)),
  };
}

/** `n` evenly spaced values from a to b (both included; the midpoint for n = 1). */
function spread(a: number, b: number, n: number): number[] {
  if (n === 1) return [(a + b) / 2];
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}

/** `n` values with a fixed step, centered on `mid`. */
function stepped(mid: number, step: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => mid + (i - (n - 1) / 2) * step);
}

/** Rows × cols of a grid for `n` fixtures. */
export function gridShape(n: number, rows?: number, cols?: number): { rows: number; cols: number } {
  if (rows && cols) return { rows, cols };
  if (rows) return { rows, cols: Math.ceil(n / rows) };
  if (cols) return { rows: Math.ceil(n / cols), cols };
  const c = Math.ceil(Math.sqrt(n));
  return { rows: Math.ceil(n / c), cols: c };
}

// ── Ordering ────────────────────────────────────

/**
 * Orders items by their current position, matching the layout's fill
 * order: grids in reading order (split into rows by y, each row by x),
 * lines by projection onto from→to, circles by clockwise angle from the
 * start angle, distribute by the axis coordinate. Align keeps the order.
 */
export function orderByPosition(items: readonly LayoutItem[], layout: Layout): LayoutItem[] {
  const list = [...items];
  switch (layout.type) {
    case 'grid': {
      const { cols } = gridShape(list.length, layout.rows, layout.cols);
      const byY = list.sort((a, b) => a.y - b.y || a.x - b.x);
      const rows: LayoutItem[][] = [];
      for (let i = 0; i < byY.length; i += cols) rows.push(byY.slice(i, i + cols).sort((a, b) => a.x - b.x));
      return rows.flat();
    }
    case 'line': {
      const dx = layout.to.x - layout.from.x;
      const dy = layout.to.y - layout.from.y;
      return list.sort((a, b) => (a.x * dx + a.y * dy) - (b.x * dx + b.y * dy));
    }
    case 'circle':
    case 'arc': {
      const start = layout.startAngle ?? 0;
      const angle = (i: LayoutItem) => ((Math.atan2(i.y - layout.center.y, i.x - layout.center.x) / RAD - start) % 360 + 720) % 360;
      return list.sort((a, b) => angle(a) - angle(b));
    }
    case 'distribute':
      return list.sort((a, b) => a[layout.axis] - b[layout.axis]);
    case 'align':
      return list;
  }
}

// ── Targets ─────────────────────────────────────

/** Grid targets (rows top→bottom, row direction 0°). */
function gridTargets(items: readonly LayoutItem[], layout: Extract<Layout, { type: 'grid' }>): LayoutTarget[] {
  const { rows, cols } = gridShape(items.length, layout.rows, layout.cols);
  if (rows * cols < items.length) throw new Error(`grid ${rows}×${cols} has room for ${rows * cols} fixtures, got ${items.length}`);
  const b = layout.bounds ?? extentOf(items);
  const usedRows = Math.ceil(items.length / cols);
  const ys = layout.gap?.y ? stepped((b.minY + b.maxY) / 2, layout.gap.y, usedRows) : spread(b.minY, b.maxY, usedRows);
  const fullXs = layout.gap?.x ? stepped((b.minX + b.maxX) / 2, layout.gap.x, cols) : spread(b.minX, b.maxX, cols);
  const step = cols > 1 ? fullXs[1]! - fullXs[0]! : 0;
  return items.map((item, i) => {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, items.length - row * cols);
    // A shorter last row keeps the column spacing and is centered.
    const xs = inRow === cols ? fullXs : stepped((fullXs[0]! + fullXs[cols - 1]!) / 2, step, inRow);
    return { id: item.id, x: xs[i - row * cols]!, y: ys[row]!, along: 0 };
  });
}

/** Circle / arc targets (tangent = clockwise travel direction). */
function circleTargets(items: readonly LayoutItem[], layout: Extract<Layout, { type: 'circle' | 'arc' }>): LayoutTarget[] {
  const start = layout.startAngle ?? 0;
  const end = layout.endAngle ?? start + 360;
  const full = Math.abs(end - start) >= 360;
  const n = items.length;
  const angles = full
    ? Array.from({ length: n }, (_, i) => start + (360 * i) / n)
    : spread(start, end, n);
  return items.map((item, i) => {
    const a = angles[i]!;
    return {
      id: item.id,
      x: layout.center.x + layout.radius * Math.cos(a * RAD),
      y: layout.center.y + layout.radius * Math.sin(a * RAD),
      along: a + (end >= start ? 90 : -90),
    };
  });
}

/**
 * Target points of `items` (in arrange order) for a layout. Throws a
 * readable error for impossible layouts (grid too small).
 */
export function layoutTargets(items: readonly LayoutItem[], layout: Layout): LayoutTarget[] {
  const targets = ((): LayoutTarget[] => {
    switch (layout.type) {
      case 'grid':
        return gridTargets(items, layout);
      case 'line': {
        const along = Math.atan2(layout.to.y - layout.from.y, layout.to.x - layout.from.x) / RAD;
        const xs = spread(layout.from.x, layout.to.x, items.length);
        const ys = spread(layout.from.y, layout.to.y, items.length);
        // A single fixture on a line sits on its midpoint.
        return items.map((item, i) => ({ id: item.id, x: xs[i]!, y: ys[i]!, along }));
      }
      case 'circle':
      case 'arc':
        return circleTargets(items, layout);
      case 'distribute': {
        const ext = extentOf(items);
        const axis = layout.axis;
        const from = layout.from ?? (axis === 'x' ? ext.minX : ext.minY);
        const to = layout.to ?? (axis === 'x' ? ext.maxX : ext.maxY);
        const values = spread(from, to, items.length);
        return items.map((item, i) => ({ ...item, [axis]: values[i]!, along: axis === 'x' ? 0 : 90 }));
      }
      case 'align': {
        const ext = extentOf(items);
        const vertical = layout.edge === 'left' || layout.edge === 'right' || layout.edge === 'centerX';
        const auto = { left: ext.minX, right: ext.maxX, centerX: (ext.minX + ext.maxX) / 2, top: ext.minY, bottom: ext.maxY, centerY: (ext.minY + ext.maxY) / 2 }[layout.edge];
        const value = layout.value ?? auto;
        return items.map(item => (vertical ? { ...item, x: value, along: 90 } : { ...item, y: value, along: 0 }));
      }
    }
  })();
  // Round float noise off computed coordinates; kept coordinates stay exact (no diff noise).
  return targets.map((t, i) => ({
    id: t.id,
    x: t.x === items[i]!.x ? t.x : round(t.x),
    y: t.y === items[i]!.y ? t.y : round(t.y),
    along: t.along,
  }));
}

/**
 * Distance of a point from the layout's shape (0 = on it); used by
 * `verify`. Grids/align/distribute check the bounds / line they define.
 */
export function distanceFromShape(p: { x: number; y: number }, layout: Layout, targets: readonly LayoutTarget[]): number {
  switch (layout.type) {
    case 'line': {
      const dx = layout.to.x - layout.from.x;
      const dy = layout.to.y - layout.from.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((p.x - layout.from.x) * dx + (p.y - layout.from.y) * dy) / len2)) : 0;
      return Math.hypot(p.x - (layout.from.x + t * dx), p.y - (layout.from.y + t * dy));
    }
    case 'circle':
    case 'arc':
      return Math.abs(Math.hypot(p.x - layout.center.x, p.y - layout.center.y) - layout.radius);
    default: {
      // Grid / distribute / align: the point must be one of the computed targets' rows / columns.
      return Math.min(...targets.map(t => Math.hypot(p.x - t.x, p.y - t.y)));
    }
  }
}

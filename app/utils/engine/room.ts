/**
 * Room box of a layout (ABI v1.3) — TypeScript twin of
 * `rs-engine/core/src/room.rs`.
 *
 * The room is the axis-aligned bounding box of every channel position in
 * normalized world units. Plugins get `Frame.worldAspect` / `worldDepth` and
 * per-sample room coordinates `Sample.u` / `Sample.v` (0–1 across the box).
 * Observation uses the twin to report room coordinates of fixtures; keep it
 * in sync with the Rust implementation (`room.test.ts` pins the Rust test
 * values).
 */

/** Extents below this count as degenerate (single row / single fixture). */
const EPS = 1e-4;

/** Room bounds derived from the layout. */
export interface Room {
  minX: number;
  minY: number;
  /** Effective width (x extent) in world units, > 0. */
  width: number;
  /** Effective depth (y extent) in world units, > 0. */
  depth: number;
  /** Meters per normalized world unit. */
  metersPerUnit: number;
}

/** The default room (unit box at the origin). */
export function defaultRoom(metersPerUnit = 0): Room {
  return { minX: 0, minY: 0, width: 1, depth: 1, metersPerUnit };
}

/**
 * Bounding box of `points`. A degenerate axis borrows the other axis'
 * extent (aspect 1 on that side); both degenerate → 1 world unit, centered.
 */
export function roomFromPoints(points: Iterable<{ x: number; y: number }>, metersPerUnit = 0): Room {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const { x, y } of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  if (!Number.isFinite(x0)) return defaultRoom(metersPerUnit);
  const w = x1 - x0;
  const d = y1 - y0;
  let width = 1;
  let depth = 1;
  if (w > EPS && d > EPS) [width, depth] = [w, d];
  else if (w > EPS) [width, depth] = [w, w];
  else if (d > EPS) [width, depth] = [d, d];
  // Center a degenerate axis so its single coordinate maps to 0.5.
  const minX = w > EPS ? x0 : x0 - width * 0.5;
  const minY = d > EPS ? y0 : y0 - depth * 0.5;
  return { minX, minY, width, depth, metersPerUnit };
}

/** Width / depth (`Frame.worldAspect`). */
export function roomAspect(room: Room): number {
  return room.width / room.depth;
}

/** Room coordinates (u, v) of a world position, 0–1 inside the box. */
export function roomUv(room: Room, x: number, y: number): { u: number; v: number } {
  return { u: (x - room.minX) / room.width, v: (y - room.minY) / room.depth };
}

/**
 * Fixture orientation in plain terms for agents (WP-K): which way the heads
 * of a fixture run on the 2D canvas, measured from the real head world
 * positions (the layout packet geometry), not assumed from `rotation`.
 *
 * Rotation convention (verified against `beamWorldPx` / `kindToWorld` and
 * the rs-engine-canvas `canvas.rotate`): `rotation` is a clockwise yaw in
 * degrees on the 2D canvas (y points down). A local offset (px, py) lands at
 * (px·cos − py·sin, px·sin + py·cos). So a bar whose heads run along its own
 * +x axis runs left→right at 0°, top→bottom at 90°, right→left at 180° and
 * bottom→top at 270°.
 */
import { z } from 'zod';
import { useEngineStore } from '~/stores/engine-store';
import type { Fixture } from '~/utils/engine/core/fixture';
import { headSamples } from '~/utils/observability/targets';

// ── Types ───────────────────────────────────────

/** Orientation of a multi-head fixture. */
export interface FixtureOrientation {
  /** Direction head 0 → last head in words, e.g. `left→right`, `top→bottom`. */
  runs: string;
  /** Unit vector head 0 → last head in world space (x right, y down), 3 decimals. */
  axis: { dx: number; dy: number };
  /** World position of head 0. */
  firstHead: { x: number; y: number };
  /** World position of the last head. */
  lastHead: { x: number; y: number };
}

/** Zod schema of {@link FixtureOrientation} (operation outputs). */
export const OrientationSchema = z.object({
  runs: z.string().describe('Direction head 0 → last head on the 2D canvas, e.g. "left→right", "top→bottom", "top-left→bottom-right".'),
  axis: z.object({ dx: z.number(), dy: z.number() }).describe('Unit vector head 0 → last head (x right, y down).'),
  firstHead: z.object({ x: z.number(), y: z.number() }).describe('World position of head 0.'),
  lastHead: z.object({ x: z.number(), y: z.number() }).describe('World position of the last head.'),
}).describe('Measured head direction; absent for single-head fixtures.');

/** One sentence stating the convention (reused in operation descriptions). */
export const ROTATION_CONVENTION = 'rotation = clockwise yaw in degrees on the 2D canvas (y down). For bars whose heads run along their own x axis: 0° = head 0 on the left, heads run toward +x (left→right); 90° = toward +y (top→bottom); 180° = right→left; 270° = bottom→top. orientation.runs / axis are measured from the real head positions, so trust them over this rule of thumb (some fixtures lay out their pixels along y, LED strips follow their drawn path).';

// ── Helpers ─────────────────────────────────────

/** Rounds to `d` decimals (and turns -0 into 0). */
function round(v: number, d = 4): number {
  const f = 10 ** d;
  return Math.round(v * f) / f + 0;
}

/** Labels for the 8 compass sectors, starting at +x and going clockwise (y down). */
const SECTORS = [
  'left→right',
  'top-left→bottom-right',
  'top→bottom',
  'top-right→bottom-left',
  'right→left',
  'bottom-right→top-left',
  'bottom→top',
  'bottom-left→top-right',
];

/** Words for a direction vector (x right, y down). */
export function runsLabel(dx: number, dy: number): string {
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const sector = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return SECTORS[sector]!;
}

/** Orientation of a head path (head order); null when the ends coincide. */
export function orientationFromPoints(points: readonly { x: number; y: number }[]): FixtureOrientation | null {
  if (points.length < 2) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  return {
    runs: runsLabel(dx, dy),
    axis: { dx: round(dx / len, 3), dy: round(dy / len, 3) },
    firstHead: { x: round(first.x), y: round(first.y) },
    lastHead: { x: round(last.x), y: round(last.y) },
  };
}

/** World positions of a fixture's engine heads in head order. */
export function headWorldPoints(f: Fixture): { x: number; y: number }[] {
  return headSamples([f], [f], () => []).map(h => ({ x: h.x, y: h.y }));
}

/** Measured orientation of a fixture (null for single-head fixtures). */
export function fixtureOrientation(f: Fixture): FixtureOrientation | null {
  return orientationFromPoints(headWorldPoints(f));
}

/**
 * `{ orientation }` of a live fixture by id for operation views (empty for
 * single-head or unknown fixtures, so the key is simply absent).
 */
export function orientationField(id: string | number): { orientation?: FixtureOrientation } {
  const live = (useEngineStore().flatFixtures as Fixture[]).find(f => String(f.id) === String(id));
  const orientation = live ? fixtureOrientation(live) : null;
  return orientation ? { orientation } : {};
}

// ── Align ───────────────────────────────────────

/** Target of `fixtures.rotate` `alignTo`. */
export type AlignTarget = 'x' | 'y' | { dx: number; dy: number };

/**
 * Rotation (0–360) that makes the fixture's head 0 → last head direction
 * point along `target` (`'x'` = left→right, `'y'` = top→bottom, or a
 * vector); `reverse` flips it. Null when the fixture has no head direction.
 */
export function rotationToAlign(f: Fixture, target: AlignTarget, reverse = false): number | null {
  const points = headWorldPoints(f);
  if (!orientationFromPoints(points)) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  // Unrounded direction (the reported axis is rounded to 3 decimals).
  const current = Math.atan2(last.y - first.y, last.x - first.x) * 180 / Math.PI;
  const wanted = target === 'x' ? 0 : target === 'y' ? 90 : Math.atan2(target.dy, target.dx) * 180 / Math.PI;
  // Heads direction at rotation 0 = current − rotation; rotation is additive.
  const raw = wanted + (reverse ? 180 : 0) - (current - (f.rotation ?? 0));
  return round(((raw % 360) + 360) % 360, 3) % 360;
}

/**
 * Stage model of the `screenshot` layout view (WP-K): plain geometry of
 * every fixture in normalized world space (0–1, x right, y down), derived
 * from the same functions the layout packet and the 2D canvas use
 * (`headSamples` / `beamWorldPx`, `kindToWorld`, footprint 18 px ×
 * `fixtureSize` rotated clockwise by `rotation`).
 *
 * Pure apart from reading the passed fixtures, so tests can build it from
 * hand-made `Fixture` instances.
 */
import type { Fixture } from '~/utils/engine/core/fixture';
import { resolvePhotometricColor } from '~/utils/engine/core/photometry';
import { FIXTURE_RADIUS, WORLD_HEIGHT, WORLD_WIDTH } from '~/utils/engine/constants';
import { kindToWorld } from '~/utils/kinds/kind-host';
import { headSamples } from '~/utils/observability/targets';

// ── Types ───────────────────────────────────────

/** A point in normalized world space. */
export interface StagePoint {
  x: number;
  y: number;
}

/** One head / pixel. */
export interface StageHead extends StagePoint {
  /** Current output color, or null when unknown (drawn neutral). */
  color: [number, number, number] | null;
}

/** One fixture. */
export interface StageFixture {
  id: string;
  name: string;
  rotation: number;
  center: StagePoint;
  /** Footprint polygon (closed, world space, rotation applied). */
  outline: StagePoint[];
  /** Heads in head order (head 0 first). */
  heads: StageHead[];
}

/** Everything the layout view draws. */
export interface StageModel {
  fixtures: StageFixture[];
  /** Where head colors come from. */
  colors: 'live' | 'none';
}

// ── Geometry ────────────────────────────────────

/** Local footprint offsets in world px (before rotation). */
function localOutline(f: Fixture): StagePoint[] {
  const hw = FIXTURE_RADIUS * (f.fixtureSize?.x ?? 1);
  const hh = FIXTURE_RADIUS * (f.fixtureSize?.y ?? 1);
  // Single-beam classic fixtures are drawn as ellipses (radii 16·w / 16·h) on the canvas.
  if (f.beams.length <= 1 && !f.definition?.pixelmapper?.customSvg?.enabled) {
    const rx = (hw * 16) / 18;
    const ry = (hh * 16) / 18;
    return Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return { x: rx * Math.cos(a), y: ry * Math.sin(a) };
    });
  }
  return [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }];
}

/** Footprint polygon in normalized world space. */
export function fixtureOutline(f: Fixture): StagePoint[] {
  const bounds = f.kind?.compiled?.bounds;
  const local = bounds
    ? [{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.w, y: bounds.y }, { x: bounds.x + bounds.w, y: bounds.y + bounds.h }, { x: bounds.x, y: bounds.y + bounds.h }]
    : localOutline(f);
  // kindToWorld = origin + offset rotated clockwise (same as the canvas transform).
  return local.map((p) => {
    const w = kindToWorld(f, p);
    return { x: w.x / WORLD_WIDTH, y: w.y / WORLD_HEIGHT };
  });
}

/** Beam id owning a head's channels (undefined = fixture-level channels). */
function headBeamId(f: Fixture, head: number): string | undefined {
  const beam = f.beams[head];
  return beam && f.channels.some(c => c.beamId === beam.id) ? beam.id : undefined;
}

// ── Model ───────────────────────────────────────

/**
 * Builds the stage model. `dmx` = latest output frame (colors via the
 * fixture photometry, like the canvas); null → neutral heads.
 */
export function buildStageModel(fixtures: readonly Fixture[], dmx: Uint8Array | null): StageModel {
  const out: StageFixture[] = fixtures.map((f) => {
    const heads = headSamples([f], [f], () => []).map(h => ({
      x: h.x,
      y: h.y,
      color: dmx ? resolvePhotometricColor(f.getPhotometry(headBeamId(f, h.head)), dmx) : null,
    }));
    return {
      id: String(f.id),
      name: String(f.name),
      rotation: f.rotation ?? 0,
      center: { x: f.fixturePosition.x, y: f.fixturePosition.y },
      outline: fixtureOutline(f),
      heads,
    };
  });
  return { fixtures: out, colors: dmx ? 'live' : 'none' };
}

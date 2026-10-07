import { Euler, Vector3 } from 'three';
import type { Fixture, StripPoint } from '~/utils/engine/core/fixture';
import { buildBeamPhotometry, type BeamPhotometry } from '~/utils/engine/core/photometry';
import { WORLD_WIDTH, WORLD_HEIGHT, FIXTURE_RADIUS, STAGE_SIZE_METERS } from '~/utils/engine/constants';
import { PIXELS_PER_METER } from '~/utils/engine/neopixel-strip-factory';
import { sampleStripCapped, pointAtArcLength } from '~/utils/engine/strip-geometry';

const DEG2RAD = Math.PI / 180;

/**
 * Full fixture footprint in meters — the 3D equivalent of the 2D canvas's
 * body box (render.rs: half_w = FIXTURE_RADIUS · fixture.width px, so the
 * full width is FIXTURE_RADIUS·2·fixtureSize px). Beam `localX/localY` are
 * normalized ±0.5 offsets across exactly this footprint.
 */
function footprintMeters(f: Fixture): { x: number; y: number } {
  const diameterPx = FIXTURE_RADIUS * 2;
  return {
    x: (f.fixtureSize?.x ?? 1) * diameterPx / PIXELS_PER_METER,
    y: (f.fixtureSize?.y ?? 1) * diameterPx / PIXELS_PER_METER,
  };
}

/** Smallest gap between adjacent distinct values, or `fallback` with <2 distinct values. */
function minAdjacentGap(values: number[], fallback: number): number {
  const distinct = [...new Set(values)].sort((a, b) => a - b);
  if (distinct.length < 2) return fallback;
  let min = Infinity;
  for (let i = 1; i < distinct.length; i++) min = Math.min(min, distinct[i]! - distinct[i - 1]!);
  return min;
}

/**
 * 2D world → 3D stage mapping. The 2D canvas is the top-down view of the
 * floor: normalized x → X, normalized y → Z, positionZ (height) → Y.
 * The 2D `rotation` (screen-space, y-down) equals a rotation about -Y in
 * three's right-handed space.
 */
export function normToMeters(v: number): number {
  return (v - 0.5) * STAGE_SIZE_METERS;
}
export function worldPxToMeters(px: number): number {
  return (px - WORLD_WIDTH / 2) / PIXELS_PER_METER;
}
export function metersToNorm(m: number): number {
  return m / STAGE_SIZE_METERS + 0.5;
}

export function fixtureEuler(f: Fixture): Euler {
  return new Euler(
    (f.tiltX || 0) * DEG2RAD,
    -(f.rotation || 0) * DEG2RAD,
    (f.rollZ || 0) * DEG2RAD,
    'YXZ',
  );
}

export function fixtureWorldPosition(f: Fixture): Vector3 {
  return new Vector3(
    normToMeters(f.fixturePosition.x),
    (f.positionZ || 0) * STAGE_SIZE_METERS,
    normToMeters(f.fixturePosition.y),
  );
}

/** Flat per-pixel render data for the instanced LED point cloud. */
export interface PixelModel {
  count: number;
  /** xyz per pixel, world meters. */
  positions: Float32Array;
  /** Point diameter per pixel, meters. */
  sizes: Float32Array;
  /** Photometry descriptor per pixel (colors, wheels, dimmers, shutters). */
  photometry: BeamPhotometry[];
  /** Pixel index → owning fixture id (for selection tinting, debugging). */
  pixelFixture: Array<string | number>;
}

/** One entry per fixture: body box for raycasting/selection + unlit visibility. */
export interface BodyModel {
  fixtureId: string | number;
  position: Vector3;
  euler: Euler;
  /** Box size in meters (x, y, z). */
  size: Vector3;
  isStrip: boolean;
}

/** Beam-capable fixture (moving head / spot / PAR with lens data). */
export interface BeamModel {
  fixtureId: string | number;
  position: Vector3;
  euler: Euler;
  panIdx: number;
  panFineIdx: number;
  tiltIdx: number;
  tiltFineIdx: number;
  /** Full pan/tilt travel in degrees (DMX 0 → -range/2, DMX max → +range/2). */
  panRangeDeg: number;
  tiltRangeDeg: number;
  /** DMX index scaling the cone angle between beamAngleMin/MaxDeg, -1 = fixed min. */
  zoomIdx: number;
  beamAngleMinDeg: number;
  beamAngleMaxDeg: number;
  /**
   * False when the fixture has no TILT channel: the cone then points UP
   * (uplight convention — a fixture sitting on the floor stays visible)
   * instead of straight down into the floor plane.
   */
  hasTilt: boolean;
  /** Photometry descriptor across all channels of the fixture. */
  photometry: BeamPhotometry;
}

/** Substrate geometry for one NeoPixel strip — the visible PCB/tube of the strip. */
export interface StripModel {
  fixtureId: string | number;
  /** Polyline in world meters, already oriented (tilt/roll about the centroid pivot). */
  polyline: Vector3[];
  /** Circle shapes form a closed ring (no seam). */
  isClosed: boolean;
  /** Tube radius in meters. */
  radius: number;
}

/** SVG artwork rendered as a textured plane at the fixture's footprint. */
export interface SvgPlaneModel {
  fixtureId: string | number;
  position: Vector3;
  euler: Euler;
  /** Plane extents in meters (fixture footprint). */
  width: number;
  height: number;
  /** Raw SVG source — doubles as the texture cache key. */
  svgData: string;
}

export interface SceneModel {
  pixels: PixelModel;
  bodies: BodyModel[];
  beams: BeamModel[];
  strips: StripModel[];
  svgPlanes: SvgPlaneModel[];
}

/** Parses OFL angle strings like "540deg" / "-270deg". */
function parseDeg(s: string | undefined): number | null {
  if (!s) return null;
  const m = /-?\d+(\.\d+)?/.exec(s);
  return m ? parseFloat(m[0]) : null;
}

function channelDmxIdx(f: Fixture, types: string[]): { idx: number; fineIdx: number } {
  for (const t of types) {
    const ch = f.channels.find(c => c.type === t && !c.isFine);
    if (ch) {
      return {
        idx: f.startAddress - 1 + ch.addressOffset,
        fineIdx: ch.resolution && ch.resolution >= 2 && ch.fineAddressOffsets?.length
          ? f.startAddress - 1 + ch.fineAddressOffsets[0]!
          : -1,
      };
    }
  }
  return { idx: -1, fineIdx: -1 };
}

/** Pan/tilt travel range in degrees from the channel's OFL capabilities. */
function capabilityRangeDeg(f: Fixture, type: 'PAN' | 'TILT', fallback: number): number {
  const ch = f.channels.find(c => c.type === type && !c.isFine);
  const caps = ch?.oflCapabilities;
  if (caps) {
    for (const cap of caps as Array<Record<string, unknown>>) {
      const a0 = parseDeg(cap.angleStart as string | undefined);
      const a1 = parseDeg(cap.angleEnd as string | undefined);
      if (a0 !== null && a1 !== null && a1 !== a0) return Math.abs(a1 - a0);
    }
  }
  return fallback;
}

interface RawPixel {
  x: number; y: number; z: number;
  size: number;
  photometry: BeamPhotometry;
  fixtureId: string | number;
}

/**
 * Converts the fixture graph into flat render models. Pure — call with
 * toRaw()'d fixtures on rebuild only, never per frame.
 */
export function buildSceneModel(fixtures: Fixture[]): SceneModel {
  const rawPixels: RawPixel[] = [];
  const bodies: BodyModel[] = [];
  const beams: BeamModel[] = [];
  const strips: StripModel[] = [];
  const svgPlanes: SvgPlaneModel[] = [];

  for (const f of fixtures) {
    const pos = fixtureWorldPosition(f);
    const euler = fixtureEuler(f);

    if (f.stripConfig) {
      const sc = f.stripConfig;
      const targetLength = sc.lengthMeters * PIXELS_PER_METER;
      const sampled = sampleStripCapped(sc.shapeType, sc.points, targetLength, sc.clockwise ?? true);
      const ledCount = Math.max(1, sc.ledCount);
      const groupSize = Math.max(1, sc.groupSize);

      // Orientation: tilt/roll about the fixture position (= strip AABB
      // centroid, kept in sync by syncStripBounds). Yaw is deliberately
      // omitted — 2D ignores `rotation` for strips and syncStripBounds resets
      // it to 0, so applying it here could only desync the top-down footprint.
      const stripEuler = new Euler((f.tiltX || 0) * DEG2RAD, 0, (f.rollZ || 0) * DEG2RAD, 'YXZ');
      const hasOrientation = stripEuler.x !== 0 || stripEuler.z !== 0;
      const toWorld = (pt: StripPoint): Vector3 => {
        const v = new Vector3(worldPxToMeters(pt.x) - pos.x, 0, worldPxToMeters(pt.y) - pos.z);
        if (hasOrientation) v.applyEuler(stripEuler);
        return v.add(pos);
      };

      // One point per PHYSICAL LED (matching the 2D renderer), colored by its
      // group's beam. Photometry is resolved once per beam and shared across
      // the group's LEDs. Same arc parametrization as 2D: 2.5% inset on open
      // shapes, full wrap on circles.
      const beamPhotometry = f.beams.map(b => buildBeamPhotometry(f, String(b.id)));
      const fallbackPhotometry = beamPhotometry[0] ?? buildBeamPhotometry(f);
      // Physical dot size from the real LED pitch — pure world size, like 2D's
      // led_r = spacing·0.45 (this is a diameter, hence ·0.9).
      const spacing = sc.lengthMeters / ledCount;
      const size = Math.max(0.004, spacing * 0.9);
      for (let led = 0; led < ledCount; led++) {
        const pixelIdx = Math.min(Math.floor(led / groupSize), f.beams.length - 1);
        const t = sc.shapeType === 'circle'
          ? led / ledCount
          : ledCount > 1 ? 0.025 + (led / (ledCount - 1)) * 0.95 : 0.5;
        const pt = pointAtArcLength(sampled, t * sampled.totalLength);
        const w = toWorld(pt);
        rawPixels.push({
          x: w.x,
          y: w.y,
          z: w.z,
          size,
          photometry: beamPhotometry[pixelIdx] ?? fallbackPhotometry,
          fixtureId: f.id,
        });
      }

      // Substrate polyline for the tube mesh — downsample the dense arc
      // samples (bezier emits 32/segment) so the merged tube stays cheap.
      if (sampled.points.length >= 2 && sampled.totalLength > 0) {
        const isClosed = sc.shapeType === 'circle';
        const pts = sampled.points;
        // For closed rings the sampler's last point duplicates the first —
        // drop it so the closed CatmullRomCurve3 doesn't get a seam kink.
        const last = isClosed ? pts.length - 1 : pts.length;
        const step = Math.max(1, Math.ceil(last / 96));
        const polyline: Vector3[] = [];
        for (let i = 0; i < last; i += step) polyline.push(toWorld(pts[i]!));
        if (!isClosed && (last - 1) % step !== 0) polyline.push(toWorld(pts[last - 1]!));
        if (polyline.length >= 2) {
          // Radius ≈ the 2D substrate's 5px stroke width (5/250/2 m), padded a
          // touch so it reads at typical orbit distances.
          strips.push({ fixtureId: f.id, polyline, isClosed, radius: 0.01 });
        }
      }

      // Strip body: small handle box at the centroid pivot — fallback raycast
      // target plus the projection anchor for line/box-select and the gizmo.
      bodies.push({
        fixtureId: f.id,
        position: pos.clone(),
        euler,
        size: new Vector3(0.15, 0.15, 0.15),
        isStrip: true,
      });
      continue;
    }

    // Regular fixture: one pixel per beam. localX/localY are normalized ±0.5
    // offsets across the fixture footprint (NOT the stage), matching 2D's
    // bx = local_x · half_w·2.
    const fp = footprintMeters(f);
    // Pixel diameter from the real slot spacing between neighboring beams,
    // mirroring render.rs (pixel_r = min(slot_w, slot_h)/2 · 0.8).
    const slotW = fp.x * minAdjacentGap(f.beams.map(b => b.localX), 1);
    const slotH = fp.y * minAdjacentGap(f.beams.map(b => b.localY), 1);
    const pixelDiameter = f.beams.length > 1
      ? Math.max(0.02, Math.min(slotW, slotH) * 0.8)
      : Math.min(fp.x, fp.y);
    for (const b of f.beams) {
      const offset = new Vector3(
        b.localX * fp.x,
        // localZ has no 2D counterpart and is 0 in practice; scale it with the
        // x-footprint so any future use stays proportional to the fixture.
        (b.localZ || 0) * fp.x,
        b.localY * fp.y,
      ).applyEuler(euler);
      rawPixels.push({
        x: pos.x + offset.x,
        y: pos.y + offset.y,
        z: pos.z + offset.z,
        size: pixelDiameter,
        photometry: buildBeamPhotometry(f, String(b.id)),
        fixtureId: f.id,
      });
    }

    bodies.push({
      fixtureId: f.id,
      position: pos.clone(),
      euler,
      size: new Vector3(Math.max(0.15, fp.x), 0.18, Math.max(0.15, fp.y)),
      isStrip: false,
    });

    // SVG artwork as a textured plane at the footprint — the dots on top
    // convey the DMX state, exactly like the 2D renderer's element fills.
    const customSvg = f.definition?.pixelmapper?.customSvg;
    if (customSvg?.enabled && customSvg.data) {
      svgPlanes.push({
        fixtureId: f.id,
        position: pos.clone(),
        euler,
        width: fp.x,
        height: fp.y,
        svgData: customSvg.data,
      });
    }

    // Beam cones: moving heads (pan/tilt), lens-bearing fixtures, and any
    // simple single-head fixture (PARs, spots, generic RGB) — only matrix/
    // multi-head panels (>2 beams) stay cone-less.
    const pan = channelDmxIdx(f, ['PAN', 'PAN_CONTINUOUS']);
    const tilt = channelDmxIdx(f, ['TILT', 'TILT_CONTINUOUS']);
    const lens = f.lensDegreesMinMax ?? f.definition?.physical?.lens?.degreesMinMax;
    if (pan.idx >= 0 || tilt.idx >= 0 || lens || f.beams.length <= 2) {
      const zoom = channelDmxIdx(f, ['ZOOM', 'BEAM_ANGLE']);
      beams.push({
        fixtureId: f.id,
        position: pos.clone(),
        euler,
        panIdx: pan.idx,
        panFineIdx: pan.fineIdx,
        tiltIdx: tilt.idx,
        tiltFineIdx: tilt.fineIdx,
        panRangeDeg: capabilityRangeDeg(f, 'PAN', 540),
        tiltRangeDeg: capabilityRangeDeg(f, 'TILT', 270),
        zoomIdx: zoom.idx,
        beamAngleMinDeg: lens?.[0] ?? 25,
        beamAngleMaxDeg: lens?.[1] ?? lens?.[0] ?? 25,
        hasTilt: tilt.idx >= 0,
        photometry: buildBeamPhotometry(f),
      });
    }
  }

  // Pack raw pixels into flat arrays for the per-frame hot loop.
  const count = rawPixels.length;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const photometry: BeamPhotometry[] = new Array(count);
  const pixelFixture: Array<string | number> = new Array(count);

  for (let i = 0; i < count; i++) {
    const p = rawPixels[i]!;
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
    sizes[i] = p.size;
    photometry[i] = p.photometry;
    pixelFixture[i] = p.fixtureId;
  }

  return {
    pixels: { count, positions, sizes, photometry, pixelFixture },
    bodies,
    beams,
    strips,
    svgPlanes,
  };
}

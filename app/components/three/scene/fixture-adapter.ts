import { Euler, Vector3 } from 'three';
import type { Fixture } from '~/utils/engine/core/fixture';
import { WORLD_WIDTH, WORLD_HEIGHT, FIXTURE_RADIUS, STAGE_SIZE_METERS } from '~/utils/engine/constants';
import { PIXELS_PER_METER } from '~/utils/engine/neopixel-strip-factory';
import { sampleStripCapped, pointAtArcLength } from '~/utils/engine/strip-geometry';

const DEG2RAD = Math.PI / 180;

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
  /** Prefix offsets (count+1) into chanIdx/weights. */
  entryStart: Uint32Array;
  /** Absolute DMX index per color entry. */
  chanIdx: Int32Array;
  /** r,g,b weight (0-1) per color entry. */
  weights: Float32Array;
  /** Absolute DMX dimmer index per pixel, -1 = none (multiplier 1). */
  dimmerIdx: Int32Array;
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

export interface ColorEntry {
  idx: number;
  r: number;
  g: number;
  b: number;
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
  colorEntries: ColorEntry[];
  dimmerIdx: number;
}

export interface SceneModel {
  pixels: PixelModel;
  bodies: BodyModel[];
  beams: BeamModel[];
}

function hexRgb(hex: string): { r: number; g: number; b: number } {
  const h = (hex || '').replace('#', '');
  return {
    r: (parseInt(h.substring(0, 2), 16) || 0) / 255,
    g: (parseInt(h.substring(2, 4), 16) || 0) / 255,
    b: (parseInt(h.substring(4, 6), 16) || 0) / 255,
  };
}

/** Parses OFL angle strings like "540deg" / "-270deg". */
function parseDeg(s: string | undefined): number | null {
  if (!s) return null;
  const m = /-?\d+(\.\d+)?/.exec(s);
  return m ? parseFloat(m[0]) : null;
}

/**
 * Mirrors the channel-selection semantics of Fixture.resolveColor / the 2D
 * canvas (FixtureCanvas.syncFixtures): channels scoped to the beam, falling
 * back to fixture-level channels when the beam has none of its own.
 */
function colorEntriesFor(f: Fixture, beamId?: string): ColorEntry[] {
  const dmxIdx = (offset: number) => f.startAddress - 1 + offset;
  let chs = f.channels.filter(c => c.role === 'COLOR' && (!beamId ? !c.beamId : c.beamId === beamId));
  if (beamId && chs.length === 0) chs = f.channels.filter(c => c.role === 'COLOR' && !c.beamId);
  return chs.map(c => ({ idx: dmxIdx(c.addressOffset), ...hexRgb(c.colorValue) }));
}

function dimmerIdxFor(f: Fixture, beamId?: string): number {
  const ch = f.channels.find(c => c.type === 'DIMMER' && (!beamId ? !c.beamId : c.beamId === beamId))
    ?? (beamId ? f.channels.find(c => c.type === 'DIMMER' && !c.beamId) : undefined);
  return ch != null ? f.startAddress - 1 + ch.addressOffset : -1;
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
  entries: ColorEntry[];
  dimmerIdx: number;
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

  for (const f of fixtures) {
    const pos = fixtureWorldPosition(f);
    const euler = fixtureEuler(f);

    if (f.stripConfig) {
      const sc = f.stripConfig;
      const targetLength = sc.lengthMeters * PIXELS_PER_METER;
      const sampled = sampleStripCapped(sc.shapeType, sc.points, targetLength, sc.clockwise ?? true);
      const ledCount = Math.max(1, sc.ledCount);
      const groupSize = Math.max(1, sc.groupSize);
      const size = Math.min(0.3, Math.max(0.04, (sc.lengthMeters / ledCount) * groupSize));
      // One point per logical pixel (= one Beam `pixel-N`), positioned at its
      // LED group's center using the SAME arc parametrization as the 2D
      // renderer (2.5% inset on open shapes, full wrap on circles).
      for (let p = 0; p < f.beams.length; p++) {
        const beam = f.beams[p]!;
        const midLed = Math.min(ledCount - 1, p * groupSize + (groupSize - 1) / 2);
        const t = sc.shapeType === 'circle'
          ? midLed / ledCount
          : ledCount > 1 ? 0.025 + (midLed / (ledCount - 1)) * 0.95 : 0.5;
        const pt = pointAtArcLength(sampled, t * sampled.totalLength);
        rawPixels.push({
          x: worldPxToMeters(pt.x),
          y: pos.y,
          z: worldPxToMeters(pt.y),
          size,
          entries: colorEntriesFor(f, String(beam.id)),
          dimmerIdx: dimmerIdxFor(f, String(beam.id)),
          fixtureId: f.id,
        });
      }
      // Strip body: thin AABB along the sampled polyline is overkill; use a
      // small handle box at the strip anchor for selection.
      bodies.push({
        fixtureId: f.id,
        position: new Vector3(worldPxToMeters(sc.points[0]?.x ?? 0), pos.y, worldPxToMeters(sc.points[0]?.y ?? 0)),
        euler,
        size: new Vector3(0.15, 0.15, 0.15),
        isStrip: true,
      });
      continue;
    }

    // Regular fixture: one pixel per beam, offsets rotated by the fixture euler.
    const bodyRadius = (FIXTURE_RADIUS * 2) / PIXELS_PER_METER;
    for (const b of f.beams) {
      const offset = new Vector3(
        b.localX * STAGE_SIZE_METERS,
        (b.localZ || 0) * STAGE_SIZE_METERS,
        b.localY * STAGE_SIZE_METERS,
      ).applyEuler(euler);
      rawPixels.push({
        x: pos.x + offset.x,
        y: pos.y + offset.y,
        z: pos.z + offset.z,
        size: f.beams.length > 1 ? Math.max(0.05, bodyRadius / Math.sqrt(f.beams.length)) : bodyRadius,
        entries: colorEntriesFor(f, String(b.id)),
        dimmerIdx: dimmerIdxFor(f, String(b.id)),
        fixtureId: f.id,
      });
    }

    bodies.push({
      fixtureId: f.id,
      position: pos.clone(),
      euler,
      size: new Vector3(
        Math.max(0.15, (f.fixtureSize?.x ?? 1) * (FIXTURE_RADIUS / PIXELS_PER_METER)),
        0.18,
        Math.max(0.15, (f.fixtureSize?.y ?? 1) * (FIXTURE_RADIUS / PIXELS_PER_METER)),
      ),
      isStrip: false,
    });

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
        colorEntries: colorEntriesFor(f),
        dimmerIdx: dimmerIdxFor(f),
      });
    }
  }

  // Pack raw pixels into flat typed arrays for the per-frame hot loop.
  const count = rawPixels.length;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const entryStart = new Uint32Array(count + 1);
  const dimmerIdx = new Int32Array(count);
  const pixelFixture: Array<string | number> = new Array(count);
  let totalEntries = 0;
  for (let i = 0; i < count; i++) totalEntries += rawPixels[i]!.entries.length;
  const chanIdx = new Int32Array(totalEntries);
  const weights = new Float32Array(totalEntries * 3);

  let e = 0;
  for (let i = 0; i < count; i++) {
    const p = rawPixels[i]!;
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
    sizes[i] = p.size;
    entryStart[i] = e;
    dimmerIdx[i] = p.dimmerIdx;
    pixelFixture[i] = p.fixtureId;
    for (const entry of p.entries) {
      chanIdx[e] = entry.idx;
      weights[e * 3] = entry.r;
      weights[e * 3 + 1] = entry.g;
      weights[e * 3 + 2] = entry.b;
      e++;
    }
  }
  entryStart[count] = e;

  return {
    pixels: { count, positions, sizes, entryStart, chanIdx, weights, dimmerIdx, pixelFixture },
    bodies,
    beams,
  };
}

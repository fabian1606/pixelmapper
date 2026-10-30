import { Euler, Vector3 } from 'three';
import type { Vec2 } from '@pixelmapper/extension-api';
import type { Fixture } from '~/utils/engine/core/fixture';
import { buildBeamPhotometry, type BeamPhotometry } from '~/utils/engine/core/photometry';
import { WORLD_WIDTH, WORLD_HEIGHT, FIXTURE_RADIUS, STAGE_SIZE_METERS } from '~/utils/engine/constants';
import { PIXELS_PER_METER, kindToWorld } from '~/utils/kinds/kind-host';
import { resolveCssColor } from '~/utils/kinds/kind-canvas';
import {
  DEFAULT_PAN_RANGE_DEG,
  DEFAULT_TILT_RANGE_DEG,
  motionRangeFromChannels,
  type MotionRange,
} from '~/utils/engine/core/motion-range';
import { movingHeadDims, type MovingHeadDims } from './moving-head-geometry';

const DEG2RAD = Math.PI / 180;
/** Height of a regular fixture's body box, meters. */
const BODY_HEIGHT_M = 0.18;
/** Lift of the emitting segments above the body's top face (avoids z-fighting). */
const SEGMENT_LIFT_M = 0.002;
/** Share of a head's slot its segment covers (gap between neighbors). */
const SEGMENT_FILL = 0.9;

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
  /** Kind fixtures get a small pivot box; their body is drawn from primitives. */
  compact: boolean;
  /**
   * Box center in the fixture's local frame (default: the origin). Moving
   * heads use it to sit their base box on the mounting plane. `position`
   * stays the fixture origin so gizmo/projection anchors are unaffected.
   */
  localOffset?: Vector3;
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
  /** Pan/tilt travel [DMX 0, DMX max] in degrees, centered by the renderer (motion-range.ts). */
  panRange: [number, number];
  tiltRange: [number, number];
  /** DMX index scaling the cone angle between beamAngleMin/MaxDeg, -1 = fixed min. */
  zoomIdx: number;
  beamAngleMinDeg: number;
  beamAngleMaxDeg: number;
  /**
   * False when the fixture has no positional TILT channel. Every cone points
   * along the fixture's local +Y (away from the mounting plane) in its
   * neutral pose; the fixture's Tilt field reorients it (180° = hanging).
   */
  hasTilt: boolean;
  /**
   * Draw the small spot head box at the cone origin. False for the per-head
   * cones of multi-head fixtures (LED bars) — their body box is the housing —
   * and for moving heads, which get the full model instead.
   */
  showHead: boolean;
  /** Procedural moving-head model (base/yoke/head); null for plain cones. */
  movingHead: MovingHeadDims | null;
  /** Photometry descriptor: the whole fixture, or one head of a multi-head fixture. */
  photometry: BeamPhotometry;
}

/** A `polyline` body primitive of a kind fixture, drawn as a tube. */
export interface PolylineModel {
  fixtureId: string | number;
  /** Polyline in world meters, already oriented (tilt/roll about the fixture origin). */
  polyline: Vector3[];
  /** Closed rings have no seam. */
  isClosed: boolean;
  /** Tube radius in meters. */
  radius: number;
  /** Stroke RGBA bytes (default: dark substrate). */
  color?: [number, number, number, number] | null;
}

/** A flat `circle` / `rect` / `polygon` body primitive of a kind fixture. */
export interface ShapeModel {
  fixtureId: string | number;
  /** Outline in world meters (oriented). */
  outline: Vector3[];
  /** Same outline in the flat kind plane (for triangulation). */
  flat: Vec2[];
  /** Fill RGBA bytes (default: dark substrate). */
  color?: [number, number, number, number] | null;
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

/** One head's slot on the emitting (top) face of a multi-head fixture. */
export interface SegmentModel {
  fixtureId: string | number;
  /** Quad center in world meters (on the body's top face). */
  position: Vector3;
  euler: Euler;
  /** Quad extents in meters along the fixture's local X / Z. */
  width: number;
  depth: number;
  /** Photometry of the head this slot shows. */
  photometry: BeamPhotometry;
}

export interface SceneModel {
  pixels: PixelModel;
  segments: SegmentModel[];
  bodies: BodyModel[];
  beams: BeamModel[];
  polylines: PolylineModel[];
  shapes: ShapeModel[];
  svgPlanes: SvgPlaneModel[];
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

/**
 * Pan/tilt travel: persisted range first, then the in-session OFL
 * capabilities (fixtures created before the range was persisted), then
 * the typical 540°/270°.
 */
function resolveMotionRange(f: Fixture): Required<Pick<MotionRange, 'pan' | 'tilt'>> & MotionRange {
  const r = f.motionRange ?? motionRangeFromChannels(f.channels) ?? {};
  return { ...r, pan: r.pan ?? DEFAULT_PAN_RANGE_DEG, tilt: r.tilt ?? DEFAULT_TILT_RANGE_DEG };
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
  const polylines: PolylineModel[] = [];
  const shapes: ShapeModel[] = [];
  const svgPlanes: SvgPlaneModel[] = [];
  const segments: SegmentModel[] = [];

  for (const f of fixtures) {
    const pos = fixtureWorldPosition(f);
    const euler = fixtureEuler(f);

    const compiled = f.kind?.compiled;
    if (compiled) {
      // Kind fixture (ADR §5.6): everything comes from the compiled build in
      // fixture-relative world pixels. Position + yaw via kindToWorld (same
      // as 2D), then tilt/roll about the fixture origin.
      const tilt = new Euler((f.tiltX || 0) * DEG2RAD, 0, (f.rollZ || 0) * DEG2RAD, 'YXZ');
      const oriented = tilt.x !== 0 || tilt.z !== 0;
      const toWorld = (p: Vec2): Vector3 => {
        const w = kindToWorld(f, p);
        const v = new Vector3(worldPxToMeters(w.x) - pos.x, 0, worldPxToMeters(w.y) - pos.z);
        if (oriented) v.applyEuler(tilt);
        return v.add(pos);
      };

      // Emitters: one point per physical emitter, colored by its beam.
      for (const b of f.beams) {
        const photometry = buildBeamPhotometry(f, String(b.id));
        const size = Math.max(0.004, (2 * (b.emitterRadius ?? 4)) / PIXELS_PER_METER);
        for (const e of b.emitters ?? (b.offsetPx ? [b.offsetPx] : [])) {
          const w = toWorld(e);
          rawPixels.push({ x: w.x, y: w.y, z: w.z, size, photometry, fixtureId: f.id });
        }
      }

      // Body primitives.
      for (const p of compiled.body) {
        switch (p.type) {
          case 'polyline': {
            // Downsample dense polylines so the merged tube stays cheap.
            const step = Math.max(1, Math.ceil(p.points.length / 96));
            const pts: Vec2[] = [];
            for (let i = 0; i < p.points.length; i += step) pts.push(p.points[i]!);
            if (!p.closed && (p.points.length - 1) % step !== 0) pts.push(p.points[p.points.length - 1]!);
            if (pts.length >= 2) {
              polylines.push({
                fixtureId: f.id,
                polyline: pts.map(toWorld),
                isClosed: !!p.closed,
                radius: Math.max(0.005, p.width / 2 / PIXELS_PER_METER),
                color: resolveCssColor(p.style.stroke, p.style.opacity),
              });
            }
            break;
          }
          case 'polygon':
          case 'rect':
          case 'circle': {
            const flat: Vec2[] = p.type === 'polygon'
              ? p.points
              : p.type === 'rect'
                ? [{ x: p.rect.x, y: p.rect.y }, { x: p.rect.x + p.rect.w, y: p.rect.y }, { x: p.rect.x + p.rect.w, y: p.rect.y + p.rect.h }, { x: p.rect.x, y: p.rect.y + p.rect.h }]
                : Array.from({ length: 32 }, (_, i) => ({
                    x: p.center.x + Math.cos((i / 32) * Math.PI * 2) * p.radius,
                    y: p.center.y + Math.sin((i / 32) * Math.PI * 2) * p.radius,
                  }));
            shapes.push({ fixtureId: f.id, outline: flat.map(toWorld), flat, color: resolveCssColor(p.style.fill ?? p.style.stroke, p.style.opacity) });
            break;
          }
          case 'svg': {
            const c = toWorld({ x: p.rect.x + p.rect.w / 2, y: p.rect.y + p.rect.h / 2 });
            svgPlanes.push({
              fixtureId: f.id,
              position: c,
              euler,
              width: p.rect.w / PIXELS_PER_METER,
              height: p.rect.h / PIXELS_PER_METER,
              svgData: p.markup,
            });
            break;
          }
        }
      }

      // Small pivot box at the origin — fallback raycast target plus the
      // projection anchor for line/box-select and the gizmo.
      bodies.push({ fixtureId: f.id, position: pos.clone(), euler, size: new Vector3(0.15, 0.15, 0.15), compact: true });
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
    // Positional pan/tilt channels (endless-rotation channels have no pose).
    const motion = resolveMotionRange(f);
    const pan = motion.panContinuous ? { idx: -1, fineIdx: -1 } : channelDmxIdx(f, ['PAN']);
    const tilt = motion.tiltContinuous ? { idx: -1, fineIdx: -1 } : channelDmxIdx(f, ['TILT']);
    // Single-head pan/tilt fixture → full moving-head model; its lens shows
    // the color, so no static pixel dot at the origin.
    const movingHead = f.beams.length === 1 && (pan.idx >= 0 || tilt.idx >= 0)
      ? movingHeadDims(f.dimensionsMm, fp.x)
      : null;

    // Per-head world positions — reused for the per-head beam cones below.
    const headPositions: Vector3[] = [];
    for (const b of f.beams) {
      const offset = new Vector3(
        b.localX * fp.x,
        // localZ has no 2D counterpart and is 0 in practice; scale it with the
        // x-footprint so any future use stays proportional to the fixture.
        (b.localZ || 0) * fp.x,
        b.localY * fp.y,
      ).applyEuler(euler);
      headPositions.push(pos.clone().add(offset));
      const photometry = buildBeamPhotometry(f, String(b.id));
      if (!movingHead) rawPixels.push({
        x: pos.x + offset.x,
        y: pos.y + offset.y,
        z: pos.z + offset.z,
        size: pixelDiameter,
        photometry,
        fixtureId: f.id,
      });

      // Emitting face: the head's slot on top of the body box, slightly
      // inset so neighboring segments stay distinguishable.
      if (f.beams.length > 1) {
        const top = new Vector3(b.localX * fp.x, BODY_HEIGHT_M / 2 + SEGMENT_LIFT_M, b.localY * fp.y).applyEuler(euler);
        segments.push({
          fixtureId: f.id,
          position: pos.clone().add(top),
          euler,
          width: Math.min(slotW, fp.x) * SEGMENT_FILL,
          depth: Math.min(slotH, fp.y) * SEGMENT_FILL,
          photometry,
        });
      }
    }

    bodies.push(movingHead
      ? {
          // The base box is the moving head's selection body.
          fixtureId: f.id,
          position: pos.clone(),
          euler,
          size: new Vector3(movingHead.width, movingHead.baseHeight, movingHead.depth),
          compact: false,
          localOffset: new Vector3(0, movingHead.baseHeight / 2, 0),
        }
      : {
          fixtureId: f.id,
          position: pos.clone(),
          euler,
          size: new Vector3(Math.max(0.15, fp.x), BODY_HEIGHT_M, Math.max(0.15, fp.y)),
          compact: false,
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
    const lens = f.lensDegreesMinMax ?? f.definition?.physical?.lens?.degreesMinMax;
    if (pan.idx >= 0 || tilt.idx >= 0 || lens || f.beams.length <= 2) {
      const zoom = channelDmxIdx(f, ['ZOOM', 'BEAM_ANGLE']);
      const shared = {
        fixtureId: f.id,
        euler,
        panIdx: pan.idx,
        panFineIdx: pan.fineIdx,
        tiltIdx: tilt.idx,
        tiltFineIdx: tilt.fineIdx,
        panRange: motion.pan,
        tiltRange: motion.tilt,
        zoomIdx: zoom.idx,
        beamAngleMinDeg: lens?.[0] ?? 25,
        beamAngleMaxDeg: lens?.[1] ?? lens?.[0] ?? 25,
        hasTilt: tilt.idx >= 0,
      };
      if (f.beams.length > 1) {
        // Multi-head (LED bars, multi-head moving bars): one cone per head at
        // its own position and color — a single fixture-center cone would
        // swallow the heads into one spot.
        f.beams.forEach((b, i) => beams.push({
          ...shared,
          position: headPositions[i]!,
          showHead: false,
          movingHead: null,
          photometry: buildBeamPhotometry(f, String(b.id)),
        }));
      } else {
        beams.push({ ...shared, position: pos.clone(), showHead: !movingHead, movingHead, photometry: buildBeamPhotometry(f) });
      }
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
    segments,
    bodies,
    beams,
    polylines,
    shapes,
    svgPlanes,
  };
}

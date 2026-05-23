import { reactive } from 'vue';
import { Fixture, type NeoPixelChipType, type StripConfig, type StripPoint, type StripShapeType } from './core/fixture';
import type { Channel } from './core/channel';
import { Beam } from './core/beam';
import type { ChannelType } from './types';
import { WORLD_WIDTH, WORLD_HEIGHT } from './constants';
import { stripBounds, enforceStripShape } from './strip-geometry';

/** World-pixels per meter (matches fixture-factory.ts world scale: 1 m = 250 px). */
export const PIXELS_PER_METER = 250;

/** Target curve length in world-pixels for a given strip config. */
export function stripTargetLength(config: { lengthMeters: number }): number {
  return config.lengthMeters * PIXELS_PER_METER;
}

/** Returns the number of DMX channels each logical pixel consumes for a given chip. */
export function channelsPerPixel(chip: NeoPixelChipType): number {
  return chip === 'SK6812-RGBW' ? 4 : 3;
}

/** ceil(ledCount / groupSize), clamped to at least 1. */
export function logicalPixelCount(ledCount: number, groupSize: number): number {
  const g = Math.max(1, Math.floor(groupSize));
  return Math.max(1, Math.ceil(ledCount / g));
}

/** Total DMX channels the strip will occupy. */
export function totalChannelCount(config: StripConfig): number {
  return logicalPixelCount(config.ledCount, config.groupSize) * channelsPerPixel(config.chipType);
}

interface ColorChannelSpec {
  type: ChannelType;
  colorValue: string;
  offset: number;
}

function channelLayoutFor(chip: NeoPixelChipType): ColorChannelSpec[] {
  const rgb: ColorChannelSpec[] = [
    { type: 'RED',   colorValue: '#FF0000', offset: 0 },
    { type: 'GREEN', colorValue: '#00FF00', offset: 1 },
    { type: 'BLUE',  colorValue: '#0000FF', offset: 2 },
  ];
  if (chip === 'SK6812-RGBW') {
    return [...rgb, { type: 'WHITE', colorValue: '#FFFFFF', offset: 3 }];
  }
  return rgb;
}

function makeChaser(defaultVal: number): Channel['chaserConfig'] {
  return reactive({
    stepValues: [defaultVal],
    stepsCount: 1,
    activeEditStep: 0,
    isPlaying: false,
    stepDuration: { mode: 'beat' as const, timeMs: 1000, beatValue: 1, beatOffset: 0 },
    fadeDuration: { mode: 'beat' as const, timeMs: 0, beatValue: 0, beatOffset: 0 },
  });
}

export interface CreateNeoPixelStripOptions {
  id: string | number;
  name?: string;
  /** 1-based global DMX start address. Will typically be overwritten by `useWorkspaceOperations` auto-assignment. */
  startAddress?: number;
}

/**
 * Builds the channel + beam arrays for a given strip config. Pure / no side
 * effects. Used both by the initial factory and by the regenerator that
 * rebuilds these when ledCount/groupSize/chipType changes on an existing
 * fixture.
 */
export function buildStripChannelsAndBeams(config: StripConfig): { channels: Channel[]; beams: Beam[] } {
  const layout = channelLayoutFor(config.chipType);
  const cpp = layout.length;
  const pixelCount = logicalPixelCount(config.ledCount, config.groupSize);

  const channels: Channel[] = [];
  for (let p = 0; p < pixelCount; p++) {
    const beamId = `pixel-${p}`;
    for (const spec of layout) {
      channels.push({
        type: spec.type,
        addressOffset: p * cpp + spec.offset,
        resolution: 1,
        role: 'COLOR',
        colorValue: spec.colorValue,
        defaultValue: 0,
        beamId,
        chaserConfig: makeChaser(0),
      });
    }
  }

  const beams: Beam[] = [];
  if (pixelCount === 1) {
    beams.push(new Beam('pixel-0', 0, 0));
  } else {
    const spreadX = (pixelCount - 1) / pixelCount;
    for (let p = 0; p < pixelCount; p++) {
      const localX = (p / (pixelCount - 1) - 0.5) * spreadX;
      beams.push(new Beam(`pixel-${p}`, localX, 0));
    }
  }

  return { channels, beams };
}

// ─── Default points per shape ────────────────────────────────────────────────

/**
 * Builds an initial `points` array for a strip of `shape` centered at (cx, cy)
 * with logical length `targetLenWorld` in world-pixel units.
 *
 *   bezier/line → 2 horizontal vertices spanning `targetLenWorld`
 *   circle      → 1 center vertex; radius is derived from target length
 */
export function defaultStripPoints(
  shape: StripShapeType,
  cx: number,
  cy: number,
  targetLenWorld: number,
): StripPoint[] {
  if (shape === 'circle') {
    return [{ x: cx, y: cy }];
  }
  const half = targetLenWorld / 2;
  return [
    { x: cx - half, y: cy },
    { x: cx + half, y: cy },
  ];
}

/**
 * Replaces `stripConfig.points` with default points for `newShape`, centered
 * on the current AABB-center of the fixture. Used when the user switches a
 * strip's shape after creation.
 *
 * Caller is responsible for capturing before/after snapshots for undo.
 */
export function regenerateStripPointsForShape(
  fixture: Fixture,
  newShape: StripShapeType,
): void {
  const cfg = fixture.stripConfig;
  if (!cfg) return;
  // Center = current normalized position × world dims (this is the AABB-center
  // set by syncStripBounds, so the new shape stays where the old one was).
  const cx = fixture.fixturePosition.x * WORLD_WIDTH;
  const cy = fixture.fixturePosition.y * WORLD_HEIGHT;
  const targetLenWorld = cfg.lengthMeters * PIXELS_PER_METER;
  cfg.shapeType = newShape;
  cfg.points = defaultStripPoints(newShape, cx, cy, targetLenWorld);
  syncStripBounds(fixture);
}

// ─── Bounds + length sync helpers ────────────────────────────────────────────

/**
 * Refreshes `fixturePosition` (normalized AABB-centroid) and `fixtureSize`
 * (normalized AABB) from the strip's visible geometry. Called after every
 * `stripConfig.points` mutation so the existing spatial index + marquee
 * selection logic keeps working without strip-specific branches.
 *
 * Shape-aware: bezier uses curve AABB; line uses 2-point AABB; circle uses
 * center ± radius (derived from target length).
 */
export function syncStripBounds(fixture: Fixture): void {
  const cfg = fixture.stripConfig;
  if (!cfg) return;
  const minPoints = cfg.shapeType === 'circle' ? 1 : 2;
  if (cfg.points.length < minPoints) return;

  const targetLen = stripTargetLength(cfg);
  const b = stripBounds(cfg.shapeType, cfg.points, targetLen);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;

  fixture.fixturePosition = {
    x: cx / WORLD_WIDTH,
    y: cy / WORLD_HEIGHT,
  };
  // fixtureSize is the HALF-AABB in 18-pixel units — matches the existing
  // convention used by both spatial.rs (half_width = width * 18) and the
  // OFL pixel-bar fixture-factory path. We clamp to a minimum so a perfectly
  // vertical or horizontal strip stays clickable.
  const FIXTURE_RADIUS = 18;
  fixture.fixtureSize = {
    x: Math.max((b.maxX - b.minX) / 2, 8) / FIXTURE_RADIUS,
    y: Math.max((b.maxY - b.minY) / 2, 8) / FIXTURE_RADIUS,
  };
  // Catmull-Rom curves don't carry a single rotation — each segment has its own
  // implicit tangent direction.
  fixture.rotation = 0;
}

/**
 * Enforces the strip's logical length (`ledCount / ledsPerMeter` × 250 px) on
 * its shape geometry by:
 *   bezier → rescaling vertices around the given anchor
 *   line   → fixing the non-anchored endpoint distance to `target_length`
 *   circle → no-op (radius is implicit)
 *
 * `anchorIdx` = index of the actively-dragged vertex (kept sticky to the cursor);
 * `null` after insert/delete/body operations.
 *
 * Always refreshes the fixture's AABB-derived position/size afterwards.
 */
export function enforceStripLength(fixture: Fixture, anchorIdx: number | null): void {
  const cfg = fixture.stripConfig;
  if (!cfg) return;
  const minPoints = cfg.shapeType === 'circle' ? 1 : 2;
  if (cfg.points.length < minPoints) return;
  const target = stripTargetLength(cfg);
  // enforceStripShape takes the *anchor* (the point that stays put). For line
  // we pass the OPPOSITE of the dragged index so the dragged endpoint moves
  // freely while the static one is the pivot. For bezier the existing scale-
  // around-anchor semantics are preserved.
  const enforceAnchor = cfg.shapeType === 'line' && anchorIdx != null
    ? (anchorIdx === 0 ? 1 : 0)
    : anchorIdx;
  enforceStripShape(cfg.shapeType, cfg.points, target, enforceAnchor);
  syncStripBounds(fixture);
}

/**
 * Programmatically builds a Fixture representing a NeoPixel-style LED strip.
 *
 * Channels: one R/G/B (+ W for RGBW) per logical pixel, linked via beamId.
 * Beams:    one per logical pixel, distributed along localX (localY = 0).
 * Size:     fixtureSize.x scales 1:1 with `lengthMeters` (UNITS_PER_METER).
 *
 * Effects/presets/color-overrides treat strips identically to OFL Pixel Bar fixtures —
 * `fixtureType` is the only branch point.
 */
export function createNeoPixelStripFixture(
  config: StripConfig,
  opts: CreateNeoPixelStripOptions,
): Fixture {
  const { channels, beams } = buildStripChannelsAndBeams(config);

  const fixture = new Fixture(opts.id, channels, opts.startAddress ?? 1);
  fixture.name = opts.name ?? `NeoPixel Strip (${config.ledCount} LEDs)`;
  fixture.manufacturer = 'Custom';
  fixture.fixtureType = 'NeoPixel Strip';

  // Initial points depend on the shape:
  //   bezier/line → 2 horizontal vertices spanning the target length
  //   circle      → 1 center point (radius is derived from target length)
  const cx = WORLD_WIDTH / 2;
  const cy = WORLD_HEIGHT / 2;
  const minPoints = config.shapeType === 'circle' ? 1 : 2;
  const points: StripPoint[] = config.points && config.points.length >= minPoints
    ? config.points.map(p => ({ ...p }))
    : defaultStripPoints(config.shapeType, cx, cy, config.lengthMeters * PIXELS_PER_METER);

  fixture.stripConfig = { ...config, points };
  fixture.beams = beams;

  // Set fixturePosition / fixtureSize from the polyline AABB so the spatial
  // index and marquee selection work without any strip-specific branching.
  syncStripBounds(fixture);

  return fixture;
}

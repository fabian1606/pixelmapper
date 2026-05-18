import { reactive } from 'vue';
import { Fixture, type NeoPixelChipType, type StripConfig, type StripPoint } from './core/fixture';
import type { Channel } from './core/channel';
import { Beam } from './core/beam';
import type { ChannelType } from './types';
import { WORLD_WIDTH, WORLD_HEIGHT } from './constants';
import { curveBounds, enforceCurveLength } from './strip-geometry';

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
    stepDuration: { mode: 'time' as const, timeMs: 1000, beatValue: 1, beatOffset: 0 },
    fadeDuration: { mode: 'time' as const, timeMs: 0, beatValue: 0, beatOffset: 0 },
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

// ─── Bounds + length sync helpers ────────────────────────────────────────────

/**
 * Refreshes `fixturePosition` (normalized curve-centroid) and `fixtureSize`
 * (normalized AABB) from the strip's Catmull-Rom curve. Called after every
 * `stripConfig.points` mutation so the existing spatial index + marquee
 * selection logic keeps working without strip-specific branches.
 */
export function syncStripBounds(fixture: Fixture): void {
  const cfg = fixture.stripConfig;
  if (!cfg || cfg.points.length < 2) return;

  const b = curveBounds(cfg.points);
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
 * its Catmull-Rom curve by rescaling vertices around the given anchor.
 *
 * Pass the index of the actively-dragged vertex as `anchorIdx` to keep the
 * cursor "sticky" to that vertex (other vertices shift to compensate). Use
 * `null` after an insert/delete/body operation to rescale around the centroid.
 *
 * Always refreshes the fixture's AABB-derived position/size afterwards.
 */
export function enforceStripLength(fixture: Fixture, anchorIdx: number | null): void {
  const cfg = fixture.stripConfig;
  if (!cfg || cfg.points.length < 2) return;
  const target = stripTargetLength(cfg);
  enforceCurveLength(cfg.points, target, anchorIdx);
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

  // Initial polyline: a horizontal 2-vertex line centered at the world center,
  // length = lengthMeters * 250 world-pixels. The caller may relocate it via
  // its body before any user reshaping.
  const halfLenWorld = config.lengthMeters * PIXELS_PER_METER / 2;
  const cx = WORLD_WIDTH / 2;
  const cy = WORLD_HEIGHT / 2;
  const points: StripPoint[] = config.points && config.points.length >= 2
    ? config.points.map(p => ({ ...p }))
    : [
        { x: cx - halfLenWorld, y: cy },
        { x: cx + halfLenWorld, y: cy },
      ];

  fixture.stripConfig = { ...config, points };
  fixture.beams = beams;

  // Set fixturePosition / fixtureSize from the polyline AABB so the spatial
  // index and marquee selection work without any strip-specific branching.
  syncStripBounds(fixture);

  return fixture;
}

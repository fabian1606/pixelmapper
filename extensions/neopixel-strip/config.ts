/**
 * Config of the `neopixel-strip` fixture kind and derived quantities.
 */

/** Addressable LED chip; determines channels per LED (RGB 3, RGBW 4). */
export type NeoPixelChipType = 'WS2812B' | 'WS2811' | 'APA102' | 'SK6812-RGB' | 'SK6812-RGBW';

/** A vertex in world pixels relative to the fixture origin. */
export interface StripPoint {
  x: number;
  y: number;
}

/**
 * Shape of the strip: `bezier` (≥2 vertices, Catmull-Rom), `line` (exactly
 * 2 vertices) or `circle` (1 vertex = center; radius from the length).
 */
export type StripShapeType = 'bezier' | 'line' | 'circle';

/** Persisted config (kind version 1.0.0). */
export interface StripConfig {
  shapeType: StripShapeType;
  chipType: NeoPixelChipType;
  /** Physical LEDs. */
  ledCount: number;
  /** LED density; strip length = ledCount / ledsPerMeter. */
  ledsPerMeter: number;
  /** Physical LEDs per logical (addressable) pixel. */
  groupSize: number;
  /** Circle only: direction of the LED order. */
  clockwise: boolean;
  /** Shape vertices; missing/invalid → defaults centered on the origin. */
  points: StripPoint[];
}

/** Chip options (label, channels per pixel). */
export const CHIP_TYPES: readonly { value: NeoPixelChipType; label: string; channels: number }[] = [
  { value: 'WS2812B', label: 'WS2812B (RGB)', channels: 3 },
  { value: 'WS2811', label: 'WS2811 (RGB)', channels: 3 },
  { value: 'APA102', label: 'APA102 (RGB)', channels: 3 },
  { value: 'SK6812-RGB', label: 'SK6812 (RGB)', channels: 3 },
  { value: 'SK6812-RGBW', label: 'SK6812 (RGBW)', channels: 4 },
];

/** Shape options. */
export const SHAPE_TYPES: readonly { value: StripShapeType; label: string }[] = [
  { value: 'bezier', label: 'Bezier curve' },
  { value: 'line', label: 'Straight line' },
  { value: 'circle', label: 'Circle' },
];

/** DMX channels per logical pixel. */
export function channelsPerPixel(chip: NeoPixelChipType): number {
  return chip === 'SK6812-RGBW' ? 4 : 3;
}

/** ceil(ledCount / groupSize), at least 1. */
export function logicalPixelCount(ledCount: number, groupSize: number): number {
  return Math.max(1, Math.ceil(ledCount / Math.max(1, Math.floor(groupSize))));
}

/** Strip length in meters. */
export function lengthMeters(c: Pick<StripConfig, 'ledCount' | 'ledsPerMeter'>): number {
  return c.ledCount / Math.max(1, c.ledsPerMeter);
}

/** Minimum vertex count of a shape. */
export function minPoints(shape: StripShapeType): number {
  return shape === 'circle' ? 1 : 2;
}

/** Default vertices of a shape centered on the origin. */
export function defaultPoints(shape: StripShapeType, targetLength: number): StripPoint[] {
  if (shape === 'circle') return [{ x: 0, y: 0 }];
  const half = targetLength / 2;
  return [{ x: -half, y: 0 }, { x: half, y: 0 }];
}

/** Default config for new strips. */
export function defaultConfig(): StripConfig {
  return { shapeType: 'bezier', chipType: 'WS2812B', ledCount: 60, ledsPerMeter: 60, groupSize: 1, clockwise: true, points: [] };
}

/**
 * Fills defaults and sanitizes counts (configs come from forms, older
 * versions and collaborators). Points are regenerated when they don't fit
 * the shape.
 */
export function normalizeConfig(raw: Partial<StripConfig> | null | undefined, pixelsPerMeter: number): StripConfig {
  const d = defaultConfig();
  const c: StripConfig = { ...d, ...(raw ?? {}) } as StripConfig;
  c.ledCount = Math.max(1, Math.round(Number(c.ledCount) || d.ledCount));
  c.ledsPerMeter = Math.max(1, Math.round(Number(c.ledsPerMeter) || d.ledsPerMeter));
  c.groupSize = Math.max(1, Math.min(c.ledCount, Math.round(Number(c.groupSize) || 1)));
  if (!SHAPE_TYPES.some(s => s.value === c.shapeType)) c.shapeType = d.shapeType;
  if (!CHIP_TYPES.some(t => t.value === c.chipType)) c.chipType = d.chipType;
  c.clockwise = c.clockwise !== false;
  const pts = Array.isArray(c.points) ? c.points.filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y)) : [];
  const ok = c.shapeType === 'bezier' ? pts.length >= 2 : pts.length === minPoints(c.shapeType);
  c.points = ok ? pts.map(p => ({ x: p.x, y: p.y })) : defaultPoints(c.shapeType, lengthMeters(c) * pixelsPerMeter);
  return c;
}

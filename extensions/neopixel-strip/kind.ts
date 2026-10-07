/**
 * The `neopixel-strip` fixture kind (ADR §5.6, plan P5.4).
 *
 * Compiles a strip config into the canonical model:
 *  - channels: R,G,B(,W) per logical pixel (groups of `groupSize` LEDs)
 *  - beams: one per logical pixel, centered on its LED group, with every
 *    physical LED as an emitter
 *  - body: the capped curve as a polyline (the strip's PCB)
 *  - handles: bezier vertices (`v:i`, vertex 0 is the anchor) and segment
 *    midpoints (`m:i`, drag to insert); line endpoints as anchors
 *
 * Geometry is in world pixels relative to the fixture origin. LEDs are
 * distributed by arc length over the capped curve: open shapes with a 2.5 %
 * inset at each end, circles over the full circumference.
 */
import { defineFixtureKind, type ChannelDef, type Handle, type Json, type KindBuildContext, type KindBuildResult } from '@pixelmapper/extension-api';
import { channelsPerPixel, defaultConfig, lengthMeters, logicalPixelCount, normalizeConfig, SHAPE_TYPES, CHIP_TYPES, type StripConfig } from './config';
import { enforceStripShape, pointAtArcLength, sampleCurve, sampleStripCapped, stripBounds } from './geometry';
import StripAddForm from './components/StripAddForm.vue';

/** Kind id (also read by ESP connector code, ADR D16). */
export const NEOPIXEL_KIND_ID = 'neopixel-strip';

/** Samples per Catmull-Rom segment of `sampleCurve` (midpoint handles). */
const SAMPLES_PER_SEGMENT = 32;

/** Substrate color (matches the former 2D strip stroke). */
const SUBSTRATE = 'rgba(40, 40, 40, 0.86)';

/** R, G, B(, W) channel layout of one pixel. */
function pixelLayout(chip: StripConfig['chipType']): { type: ChannelDef['type']; color: string }[] {
  const rgb = [
    { type: 'RED' as const, color: '#FF0000' },
    { type: 'GREEN' as const, color: '#00FF00' },
    { type: 'BLUE' as const, color: '#0000FF' },
  ];
  return channelsPerPixel(chip) === 4 ? [...rgb, { type: 'WHITE' as const, color: '#FFFFFF' }] : rgb;
}

/** Arc parameter (0–1) of LED `i` of `n`. */
function ledT(shape: StripConfig['shapeType'], i: number, n: number): number {
  if (shape === 'circle') return n >= 1 ? i / n : 0;
  return n > 1 ? 0.025 + (i / (n - 1)) * 0.95 : 0.5;
}

/** Builds the canonical model of a strip. Pure. */
export function buildStrip(raw: Json, ctx: KindBuildContext): KindBuildResult {
  const c = normalizeConfig(raw as Partial<StripConfig>, ctx.pixelsPerMeter);
  const targetLength = lengthMeters(c) * ctx.pixelsPerMeter;
  const sampled = sampleStripCapped(c.shapeType, c.points, targetLength, c.clockwise);
  const layout = pixelLayout(c.chipType);
  const pixels = logicalPixelCount(c.ledCount, c.groupSize);

  // Channels: one RGB(W) group per logical pixel.
  const channels: ChannelDef[] = [];
  for (let p = 0; p < pixels; p++) {
    layout.forEach((l, k) => channels.push({
      type: l.type,
      role: 'COLOR',
      addressOffset: p * layout.length + k,
      colorValue: l.color,
      defaultValue: 0,
      beamId: `pixel-${p}`,
    }));
  }

  // Beams: every LED of the group is an emitter; the beam sits on the group's center LED.
  const at = (t: number) => pointAtArcLength(sampled, t * sampled.totalLength);
  const spacing = sampled.totalLength / c.ledCount;
  const beams = Array.from({ length: pixels }, (_, p) => {
    const first = p * c.groupSize;
    const last = Math.min(first + c.groupSize - 1, c.ledCount - 1);
    const emitters = [];
    for (let led = first; led <= last; led++) emitters.push(at(ledT(c.shapeType, led, c.ledCount)));
    return {
      id: `pixel-${p}`,
      pos: at(ledT(c.shapeType, (first + last) / 2, c.ledCount)),
      emitters,
      emitterRadius: Math.max(0.5, spacing * 0.45),
    };
  });

  // Handles.
  const handles: Handle[] = [];
  if (c.shapeType === 'bezier') {
    c.points.forEach((p, i) => handles.push({ id: `v:${i}`, pos: { ...p }, role: i === 0 ? 'anchor' : 'vertex' }));
    // Midpoints sit on the full (uncapped) curve, at each segment's arc midpoint.
    const full = sampleCurve(c.points, SAMPLES_PER_SEGMENT);
    for (let i = 0; i < c.points.length - 1; i++) {
      const s0 = full.cumulative[i * SAMPLES_PER_SEGMENT] ?? 0;
      const s1 = full.cumulative[(i + 1) * SAMPLES_PER_SEGMENT] ?? s0;
      handles.push({ id: `m:${i}`, pos: pointAtArcLength(full, (s0 + s1) / 2), role: 'midpoint' });
    }
  }
  else if (c.shapeType === 'line') {
    c.points.forEach((p, i) => handles.push({ id: `v:${i}`, pos: { ...p }, role: 'anchor' }));
  }

  const b = stripBounds(c.shapeType, c.points, targetLength);
  return {
    channels,
    beams,
    body: [{
      type: 'polyline',
      points: sampled.points.map(p => ({ x: p.x, y: p.y })),
      closed: c.shapeType === 'circle',
      width: 5,
      style: { stroke: SUBSTRATE },
    }],
    handles,
    bounds: { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY },
  };
}

/** Parses `v:3` / `m:2` handle ids. */
function parseHandle(id: string): { kind: 'v' | 'm'; index: number } | null {
  const m = /^([vm]):(\d+)$/.exec(id);
  return m ? { kind: m[1] as 'v' | 'm', index: Number(m[2]) } : null;
}

/**
 * Handle drag (pure, from the drag-start config): vertices follow the
 * pointer (lines keep their length by moving the other end); a midpoint
 * inserts a vertex and places it.
 */
export function moveHandle(raw: Json, handleId: string, pos: { x: number; y: number }, ctx: KindBuildContext): Json {
  const c = normalizeConfig(raw as Partial<StripConfig>, ctx.pixelsPerMeter);
  const h = parseHandle(handleId);
  if (!h) return c as unknown as Json;
  const points = c.points.map(p => ({ ...p }));
  if (h.kind === 'm') {
    if (c.shapeType !== 'bezier' || h.index >= points.length - 1) return c as unknown as Json;
    points.splice(h.index + 1, 0, { x: pos.x, y: pos.y });
  }
  else {
    if (!points[h.index]) return c as unknown as Json;
    points[h.index] = { x: pos.x, y: pos.y };
    // Lines keep their length: the other endpoint is the pivot.
    if (c.shapeType === 'line') enforceStripShape('line', points, lengthMeters(c) * ctx.pixelsPerMeter, h.index === 0 ? 1 : 0);
  }
  return { ...c, points } as unknown as Json;
}

/** Deletes a bezier vertex (never the anchor, never below 2 vertices). */
export function deleteHandle(raw: Json, handleId: string, ctx: KindBuildContext): Json {
  const c = normalizeConfig(raw as Partial<StripConfig>, ctx.pixelsPerMeter);
  const h = parseHandle(handleId);
  if (!h || h.kind !== 'v' || c.shapeType !== 'bezier' || h.index === 0 || c.points.length <= 2) return c as unknown as Json;
  return { ...c, points: c.points.filter((_, i) => i !== h.index) } as unknown as Json;
}

export const neopixelStripKind = defineFixtureKind<Json>({
  id: NEOPIXEL_KIND_ID,
  version: '1.0.0',
  label: 'NeoPixel Strip',
  icon: 'spline',
  description: 'Parametric addressable LED strip (WS2812B, SK6812, …) as a bezier curve, straight line or circle. LEDs are distributed by arc length; groups of LEDs can share one logical pixel. Click a selected strip again to edit its curve.',
  configSchema: [
    { key: 'shapeType', type: 'enum', options: SHAPE_TYPES.map(s => s.value), optionLabels: SHAPE_TYPES.map(s => s.label), default: 'bezier', label: 'Shape' },
    { key: 'chipType', type: 'enum', options: CHIP_TYPES.map(c => c.value), optionLabels: CHIP_TYPES.map(c => c.label), default: 'WS2812B', label: 'Chip' },
    { key: 'ledCount', type: 'int', min: 1, max: 2000, default: 60, label: 'LED count' },
    { key: 'ledsPerMeter', type: 'int', min: 1, max: 500, default: 60, label: 'LEDs / meter' },
    { key: 'groupSize', type: 'int', min: 1, max: 2000, default: 1, label: 'Group size', description: 'Physical LEDs sharing one logical pixel.' },
    { key: 'clockwise', type: 'bool', default: true, label: 'Clockwise (circle)' },
  ],
  defaults: () => defaultConfig() as unknown as Json,
  build: buildStrip,
  onHandleMove: moveHandle,
  onHandleDelete: deleteHandle,
  library: { category: 'Pixel Bar', addForm: StripAddForm },
  // Pixel strips are fed as one buffer; they may cross DMX universe boundaries.
  spansUniverses: true,
});

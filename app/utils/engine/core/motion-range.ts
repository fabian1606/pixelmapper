import type { Channel } from './channel';

/**
 * Pan/tilt travel of a moving head, derived from the OFL capabilities at
 * fixture creation and persisted on the fixture (OFL capabilities are not),
 * so the 3D motion range survives project reloads.
 *
 * Angles are the OFL `angleStart` / `angleEnd` of the positional capability:
 * DMX 0 → start, DMX max → end. Renderers center the range, i.e. the DMX
 * midpoint is the neutral pose (beam straight out of the base).
 */
export interface MotionRange {
  pan?: [number, number];
  tilt?: [number, number];
  /** Channel is an endless-rotation speed control, not a position. */
  panContinuous?: boolean;
  tiltContinuous?: boolean;
}

/** Fallback travel when a fixture has a positional channel but no angle data. */
export const DEFAULT_PAN_RANGE_DEG: [number, number] = [0, 540];
export const DEFAULT_TILT_RANGE_DEG: [number, number] = [0, 270];

/**
 * Parses OFL angle values like "540deg" / "-270deg" / 540. Percentages and
 * keywords ("0%", "left") carry no absolute angle → null.
 */
export function parseDeg(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*deg\s*$/i.exec(v);
  return m ? parseFloat(m[1]!) : null;
}

type Axis = 'Pan' | 'Tilt';

/**
 * Angle span of one axis from a channel's capabilities: the extremes over
 * every positional capability, oriented by DMX order (inverted fixtures keep
 * start > end).
 */
function axisFromCapabilities(
  caps: Array<Record<string, unknown>>,
  axis: Axis,
): { range?: [number, number]; continuous: boolean } {
  let first: { dmx: number; deg: number } | null = null;
  let last: { dmx: number; deg: number } | null = null;
  let positional = false;
  let continuous = false;

  for (const cap of caps) {
    if (cap.type === `${axis}Continuous`) continuous = true;
    if (cap.type !== axis) continue;
    positional = true;
    const a0 = parseDeg(cap.angleStart ?? cap.angle);
    const a1 = parseDeg(cap.angleEnd ?? cap.angle);
    if (a0 === null || a1 === null) continue;
    const dmx = (cap.dmxRange as [number, number] | undefined) ?? [0, 255];
    if (!first || dmx[0] < first.dmx) first = { dmx: dmx[0], deg: a0 };
    if (!last || dmx[1] > last.dmx) last = { dmx: dmx[1], deg: a1 };
  }

  const range = first && last && first.deg !== last.deg ? [first.deg, last.deg] as [number, number] : undefined;
  // Only an endless-rotation channel counts as continuous — a channel that
  // also has a positional segment is still driven as a position.
  return { range, continuous: continuous && !positional };
}

/** Derives the motion range from the (non-fine) PAN/TILT channels' OFL capabilities. */
export function motionRangeFromChannels(channels: Channel[]): MotionRange | undefined {
  const out: MotionRange = {};
  for (const [type, axis] of [['PAN', 'Pan'], ['TILT', 'Tilt']] as const) {
    const ch = channels.find(c => c.type === type && !c.isFine);
    if (!ch?.oflCapabilities) continue;
    const { range, continuous } = axisFromCapabilities(ch.oflCapabilities as Array<Record<string, unknown>>, axis);
    const key = axis === 'Pan' ? 'pan' : 'tilt';
    if (range) out[key] = range;
    if (continuous) out[`${key}Continuous`] = true;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Normalized DMX position (0…1) → angle in degrees relative to the range
 * center, e.g. [0, 540] maps 0 → -270, 0.5 → 0, 1 → +270.
 */
export function axisAngleDeg(range: [number, number], t: number): number {
  const [start, end] = range;
  return start + (end - start) * t - (start + end) / 2;
}

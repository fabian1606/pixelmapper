import type { WaveformShape } from '../types';

const TAU = Math.PI * 2;

/**
 * Evaluate a waveform shape at normalized cycle position t ∈ [0, 1).
 * Returns a value in [-1, 1] (bounce returns [0, 1]).
 */
export function evaluateShape(shape: WaveformShape, t: number, param: number = 0.5): number {
  switch (shape) {
    case 'sine':
      return Math.sin(t * TAU);

    case 'square': {
      const duty = 0.05 + param * 0.9;
      return t < duty ? 1 : -1;
    }

    case 'triangle': {
      const peak = 0.05 + param * 0.9;
      if (t < peak) return (2 * t) / peak - 1;
      return 1 - (2 * (t - peak)) / (1 - peak);
    }

    case 'sawtooth':
      return param < 0.5 ? 1 - 2 * t : 2 * t - 1;

    case 'bounce': {
      const count = Math.round(1 + param * 4);
      return Math.abs(Math.sin(count * Math.PI * t));
    }

    case 'ramp': {
      const softness = 0.1 + param * 9.9;
      const denom = Math.tanh(softness * 3);
      return denom === 0 ? (t < 0.5 ? -1 : 1) : Math.tanh(softness * (t - 0.5) * 6) / denom;
    }

    case 'smooth': {
      // Piecewise cosine: tangent-zero at both endpoints, peak at `peak` position.
      // Rise: -cos(π*t/peak)  →  -1 at t=0 (slope=0), +1 at t=peak (slope=0)
      // Fall: cos(π*(t-peak)/(1-peak))  →  +1 at t=peak (slope=0), -1 at t=1 (slope=0)
      const peak = 0.05 + param * 0.9;
      if (t <= peak) return -Math.cos(Math.PI * t / peak);
      return Math.cos(Math.PI * (t - peak) / (1 - peak));
    }

    default:
      return Math.sin(t * TAU);
  }
}

/**
 * Evaluate a phase value (in radians) against a shape with start/end windowing.
 * Before `start`: holds at `startLevel` (or shape's natural value at t=0 if omitted).
 * After `end`: holds at `endLevel` (or shape's natural value at t=1 if omitted).
 * Between `start` and `end`: evaluates the full waveform cycle.
 */
export function evaluatePhase(
  phase: number,
  shape: WaveformShape,
  param: number,
  start: number,
  end: number,
  startLevel?: number,
  endLevel?: number,
): number {
  const cycleT = (((phase / TAU) % 1) + 1) % 1;

  if (start >= end) return evaluateShape(shape, cycleT, param);

  const sl = startLevel ?? evaluateShape(shape, 0, param);
  const el = endLevel ?? evaluateShape(shape, 1, param);

  if (cycleT < start) return sl;
  if (cycleT > end) return el;

  const localT = (cycleT - start) / (end - start);
  return evaluateShape(shape, localT, param);
}

/**
 * Sample a waveform into points for SVG rendering.
 * Returns array of { x: 0..1, y: 0..1 } where y=0 is top.
 */
export function sampleWaveform(
  shape: WaveformShape,
  param: number,
  start: number,
  end: number,
  samples = 80,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const raw = evaluatePhase(t * TAU, shape, param, start, end);
    points.push({ x: t, y: 0.5 - raw * 0.5 });
  }
  return points;
}

/** Convert waveform sample points to an SVG polyline `points` attribute string. */
export function pointsToSvgString(
  points: Array<{ x: number; y: number }>,
  width: number,
  height: number,
): string {
  return points.map(p => `${(p.x * width).toFixed(1)},${(p.y * height).toFixed(1)}`).join(' ');
}

/** Human-readable label for a waveform shape. */
export function shapeLabel(shape: WaveformShape): string {
  switch (shape) {
    case 'sine':     return 'Sine';
    case 'square':   return 'Square';
    case 'triangle': return 'Triangle';
    case 'sawtooth': return 'Sawtooth';
    case 'bounce':   return 'Bounce';
    case 'ramp':     return 'Ramp';
    case 'smooth':   return 'Smooth';
  }
}

export const ALL_WAVEFORM_SHAPES: WaveformShape[] = [
  'sine', 'square', 'triangle', 'sawtooth', 'bounce', 'ramp', 'smooth',
];

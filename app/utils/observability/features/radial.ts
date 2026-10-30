/**
 * `radial` feature (ADR 0002 §6.3): does the motion propagate away from
 * (or towards) points of interest? Pearson r of per-sample lag vs. distance
 * to the nearest point. Mirror symmetry lives in `mirror.ts`.
 */
import type { TracePoint } from '../types';
import type { Radial, Temporal } from './types';
import type { SpatialSample } from './spatial';
import { argsort, fitLine, pearson, round4 } from './signal';
import { unwrapAlong } from './spatial';

// ── Radial ──────────────────────────────────────

/** |r| above which a radial propagation is reported. */
const RADIAL_R = 0.5;

/**
 * Radial verdict. Periodic groups use the phase lags (unwrapped along the
 * distance, converted to seconds); other groups the time of peak intensity.
 */
export function analyzeRadial(
  samples: SpatialSample[],
  points: TracePoint[],
  temporal: Temporal,
  lags: Float64Array | null,
  times: Float64Array,
): Radial {
  const from = points.map(p => ({ key: p.key, x: round4(p.x), y: round4(p.y) }));
  const none: Radial = { from, r: 0, speed: 0, kind: 'none' };
  const idx = samples.map((_, i) => i).filter(i => !samples[i]!.signal.constant);
  if (idx.length < 3 || points.length === 0 || temporal.kind === 'constant') return none;
  // Distance of every active sample to its nearest point.
  const d = Float64Array.from(idx.map(i => {
    const s = samples[i]!;
    return Math.min(...points.map(p => Math.hypot(s.x - p.x, s.y - p.y)));
  }));
  let lagS: Float64Array;
  if (temporal.kind === 'periodic' && lags) {
    const l = Float64Array.from(idx.map(i => lags[i]!));
    if (l.some(v => !Number.isFinite(v))) return none;
    lagS = unwrapAlong(l, argsort(d)).map(v => v / temporal.hz);
  } else {
    // Time of peak intensity.
    lagS = Float64Array.from(idx.map(i => {
      const it = samples[i]!.signal.intensity;
      let best = 0;
      for (let f = 1; f < it.length; f++) if (it[f]! > it[best]!) best = f;
      return times[best] ?? 0;
    }));
  }
  const r = pearson(d, lagS);
  const slope = fitLine(d, lagS).slope;
  const kind = r > RADIAL_R ? 'outward' : r < -RADIAL_R ? 'inward' : 'none';
  return { from, r: round4(r), speed: Math.abs(slope) > 1e-9 ? round4(1 / Math.abs(slope)) : 0, kind };
}

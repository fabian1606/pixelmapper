/**
 * `radial` and `symmetry` features (ADR 0002 §6.3).
 *
 * - radial: does the motion propagate away from (or towards) points of
 *   interest? Pearson r of per-sample lag vs. distance to the nearest point;
 * - symmetry: correlation of the samples with their mirror partners
 *   across the vertical axis through the layout's center.
 */
import type { TracePoint } from '../types';
import type { Radial, Symmetry, Temporal } from './types';
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

// ── Symmetry ────────────────────────────────────

/**
 * Mirror symmetry across the vertical axis through the center of the
 * samples' x extent: each sample is paired with the sample nearest to its
 * mirrored position; Pearson r over all paired intensity values. Null for
 * fewer than 4 samples.
 */
export function analyzeSymmetry(samples: SpatialSample[]): Symmetry | null {
  if (samples.length < 4) return null;
  const xs = samples.map(s => s.x);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const frames = samples[0]!.signal.frames;
  const a = new Float64Array(samples.length * frames);
  const b = new Float64Array(samples.length * frames);
  samples.forEach((s, i) => {
    // Mirror partner: nearest sample to (2·cx − x, y).
    const mx = 2 * cx - s.x;
    let partner = s;
    let bestD = Infinity;
    for (const o of samples) {
      const dd = (o.x - mx) ** 2 + (o.y - s.y) ** 2;
      if (dd < bestD) {
        bestD = dd;
        partner = o;
      }
    }
    a.set(s.signal.intensity, i * frames);
    b.set(partner.signal.intensity, i * frames);
  });
  // Identical constant halves: perfectly symmetric.
  const identical = a.every((v, i) => Math.abs(v - b[i]!) < 1e-6);
  return { axis: 'x', x: round4(cx), corr: identical ? 1 : round4(pearson(a, b)) };
}

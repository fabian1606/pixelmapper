/**
 * `mirror` feature (ADR 0002 §6.3, plan M6): mirror symmetry of the output.
 *
 * For each axis the samples are reflected across a mirror line — `x`: the
 * vertical line `x = at` (left ↔ right), `y`: the horizontal line `y = at`
 * (front ↔ back). Every sample is paired with the sample nearest to its
 * mirrored position (within a tolerance derived from the sample spacing);
 * `r` is the Pearson correlation of the paired intensity series over all
 * pairs. r ≈ 1: mirror images; r ≈ −1: complementary halves; r ≈ 0: no
 * relation (e.g. a chase across the axis).
 *
 * Mirror lines default to the room center (center of the engine's room box,
 * the same line `Sample.u/v = 0.5` plugins use); `observe` passes them via
 * `Trace.mirrorAxes` (request `mirror: { x?, y? }` overrides).
 */
import type { MirrorAxis, MirrorFeature } from './types';
import type { SpatialSample } from './spatial';
import { pearson, round4 } from './signal';

// ── Pairing ─────────────────────────────────────

/** Minimal number of non-self pairs for an axis verdict. */
const MIN_PAIRS = 2;
/** Absolute floor of the pairing tolerance (world units). */
const MIN_TOLERANCE = 0.02;

/** Median distance of each sample to its nearest neighbour (0 for < 2 samples). */
function medianSpacing(samples: SpatialSample[]): number {
  if (samples.length < 2) return 0;
  const nn = samples.map((s, i) => {
    let best = Infinity;
    samples.forEach((o, j) => {
      if (i !== j) best = Math.min(best, Math.hypot(o.x - s.x, o.y - s.y));
    });
    return best;
  }).sort((a, b) => a - b);
  return nn[Math.floor(nn.length / 2)]!;
}

/**
 * Correlation across one mirror line. `reflect` maps a position to its
 * mirror image. Null when fewer than `MIN_PAIRS` samples have a partner.
 */
function axisMirror(samples: SpatialSample[], at: number, reflect: (x: number, y: number) => [number, number], tolerance: number): MirrorAxis | null {
  const a: number[] = [];
  const b: number[] = [];
  let pairs = 0;
  for (const s of samples) {
    const [mx, my] = reflect(s.x, s.y);
    let partner: SpatialSample | null = null;
    let bestD = Infinity;
    for (const o of samples) {
      const d = Math.hypot(o.x - mx, o.y - my);
      if (d < bestD) {
        bestD = d;
        partner = o;
      }
    }
    // Samples on the mirror line pair with themselves: no information.
    if (!partner || partner === s || bestD > tolerance) continue;
    pairs++;
    for (const v of s.signal.intensity) a.push(v);
    for (const v of partner.signal.intensity) b.push(v);
  }
  if (pairs < MIN_PAIRS) return null;
  // Identical (also constant) halves are perfectly symmetric.
  const identical = a.every((v, i) => Math.abs(v - b[i]!) < 1e-6);
  return { at: round4(at), r: identical ? 1 : round4(pearson(a, b)), pairs };
}

// ── Entry point ─────────────────────────────────

/**
 * Mirror features of a sample set. `axes` are the mirror lines (world
 * coordinates); without them the center of the samples' extent is used.
 * Null when neither axis has enough pairs.
 */
export function analyzeMirror(samples: SpatialSample[], axes?: { x?: number; y?: number }): MirrorFeature | null {
  if (samples.length < 2) return null;
  const xs = samples.map(s => s.x);
  const ys = samples.map(s => s.y);
  const ax = axes?.x ?? (Math.min(...xs) + Math.max(...xs)) / 2;
  const ay = axes?.y ?? (Math.min(...ys) + Math.max(...ys)) / 2;
  const tolerance = Math.max(MIN_TOLERANCE, 0.6 * medianSpacing(samples));
  const x = axisMirror(samples, ax, (px, py) => [2 * ax - px, py], tolerance);
  const y = axisMirror(samples, ay, (px, py) => [px, 2 * ay - py], tolerance);
  if (!x && !y) return null;
  return { ...(x ? { x } : {}), ...(y ? { y } : {}) };
}

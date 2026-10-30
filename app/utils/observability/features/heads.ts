/**
 * Per-head features (`fixtures.<id>.heads[i]`) and the onset `order` of a
 * group (ADR 0002 §6.3).
 *
 * Fixture-level features pool their heads, which hides what single pixels
 * of an LED tube do ("is every pixel lit?", "do the pixels light up one
 * after another?"). Each head therefore gets a compact record: its range,
 * the time of its peak and its first onset (first rising crossing of the
 * group's mid level). `orderOf` turns the onsets into a direction verdict
 * along the spread (rank / spatial) or the layout order (fixture, head).
 */
import type { HeadFeatures, OnsetOrder } from './types';
import type { Signal } from './signal';
import { argsort, pearson, round4 } from './signal';
import { rawRange } from './range';

// ── Thresholds ──────────────────────────────────

/** |r| from which the onset order counts as a direction. */
const ORDER_R = 0.8;
/** Gain of |r| a cyclic rotation needs to be preferred over the plain order. */
const CYCLIC_GAIN = 0.1;

// ── Onsets ──────────────────────────────────────

/**
 * Mid level between the pooled min and max intensity of `signals` (onset
 * threshold shared by every head, so dim heads light up later or never).
 * Null when the signals do not vary.
 */
export function onsetLevel(signals: Signal[]): number | null {
  const r = rawRange(signals.map(s => s.intensity));
  return r.max - r.min < 0.02 ? null : r.min + (r.max - r.min) / 2;
}

/**
 * Time of the first rising crossing of `level` (s, relative to the window
 * start); undefined without one. A head that is already above the level
 * at the first frame has no onset until it dropped below it once.
 */
export function firstOnset(intensity: Float64Array, level: number | null, times: Float64Array): number | undefined {
  if (level === null) return undefined;
  for (let f = 1; f < intensity.length; f++) {
    if (intensity[f - 1]! < level && intensity[f]! >= level) return round4(times[f]!);
  }
  return undefined;
}

/** Compact features of one head: range (no sd), peak time, first onset. */
export function headFeatures(sig: Signal, level: number | null, times: Float64Array): HeadFeatures {
  const r = rawRange([sig.intensity]);
  let peak = 0;
  for (let f = 1; f < sig.intensity.length; f++) if (sig.intensity[f]! > sig.intensity[peak]! + 1e-9) peak = f;
  const onset = firstOnset(sig.intensity, level, times);
  return {
    range: { min: round4(r.min), max: round4(r.max), mean: round4(r.mean) },
    peak: round4(times[peak] ?? 0),
    ...(onset !== undefined ? { onset } : {}),
  };
}

// ── Order ───────────────────────────────────────

/** A sample as seen by the order analysis. */
export interface OrderSample {
  /** `<fixtureId>.<head>` (report label). */
  key: string;
  /** Position along the spread (rank / spatial), if known. */
  spread?: number;
  /** Index in layout order (fixture order, then head). */
  layout: number;
  onset?: number;
}

/** Pearson r of onset vs. position after rotating the order by `shift` (loop seam). */
function rotatedR(onsets: number[], shift: number): number {
  const n = onsets.length;
  const pos = onsets.map((_, i) => (i - shift + n) % n);
  return pearson(pos, onsets);
}

/**
 * Onset order of a group: Pearson r of first-onset time vs. position
 * along the spread (all samples have one) or the layout order. Loops
 * (a chase around a ring starting mid-way) are handled by trying every
 * cyclic rotation of the order; `cyclic` marks a rotated fit.
 * Null with fewer than 2 onsets.
 */
export function orderOf(samples: OrderSample[], frameS: number): OnsetOrder | null {
  const withOnset = samples.filter(s => s.onset !== undefined);
  if (withOnset.length < 2) return null;
  const bySpread = withOnset.every(s => s.spread !== undefined && Number.isFinite(s.spread));
  const keys = withOnset.map(s => (bySpread ? s.spread! : s.layout));
  const sorted = argsort(keys).map(i => withOnset[i]!);
  const onsets = sorted.map(s => s.onset!);
  const span = Math.max(...onsets) - Math.min(...onsets);
  const first = sorted.reduce((a, b) => (b.onset! < a.onset! ? b : a));
  const last = sorted.reduce((a, b) => (b.onset! > a.onset! ? b : a));
  const base = { axis: bySpread ? 'spread' as const : 'layout' as const, onsets: withOnset.length, of: samples.length, span: round4(span), first: first.key, last: last.key };
  // All within one frame: they light up together.
  if (span <= frameS * 1.01) return { ...base, direction: 'simultaneous', r: 0, cyclic: false };
  let r = pearson(onsets.map((_, i) => i), onsets);
  let cyclic = false;
  // Loop seam: the best cyclic rotation (O(n²), n = onset samples).
  if (onsets.length >= 3 && onsets.length <= 512) {
    for (let shift = 1; shift < onsets.length; shift++) {
      const rr = rotatedR(onsets, shift);
      if (Math.abs(rr) > Math.abs(r) + CYCLIC_GAIN) {
        r = rr;
        cyclic = true;
      }
    }
  }
  const direction = r >= ORDER_R ? 'forward' : r <= -ORDER_R ? 'reverse' : 'none';
  return { ...base, direction, r: round4(r), cyclic };
}

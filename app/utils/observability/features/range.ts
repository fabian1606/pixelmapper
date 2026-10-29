/**
 * `range` feature (ADR 0002 §6.3): min, max, mean and standard deviation,
 * pooled over several series.
 */
import type { Range } from './types';
import { round4 } from './signal';

// ── Range ───────────────────────────────────────

/** Unrounded range statistics pooled over all values of `series`. */
export function rawRange(series: ArrayLike<number>[]): Range {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (const s of series) {
    for (let i = 0; i < s.length; i++) {
      const v = s[i]!;
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      sq += v * v;
      n++;
    }
  }
  if (n === 0) return { min: 0, max: 0, mean: 0, sd: 0 };
  const mean = sum / n;
  return { min, max, mean, sd: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
}

/** Range statistics pooled over all values of `series`, rounded for JSON. */
export function rangeOf(series: ArrayLike<number>[]): Range {
  const r = rawRange(series);
  return { min: round4(r.min), max: round4(r.max), mean: round4(r.mean), sd: round4(r.sd) };
}

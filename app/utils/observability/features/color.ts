/**
 * `color` feature of rgb signals (ADR 0002 §6.3): hue (circular stats and
 * the shortest covering arc), saturation, HSV value and a named bucket.
 */
import type { Color, ColorName } from './types';
import type { Signal } from './signal';
import { round4 } from './signal';
import { rangeOf } from './range';

// ── Thresholds ──────────────────────────────────

/** Minimum saturation / value for a frame's hue to count. */
const HUE_MIN_SAT = 0.1;
const HUE_MIN_VALUE = 0.05;

/** Hue buckets: upper bound (exclusive, degrees) → name. */
const HUE_BUCKETS: Array<[number, ColorName]> = [
  [15, 'red'],
  [45, 'orange'],
  [70, 'yellow'],
  [160, 'green'],
  [200, 'cyan'],
  [260, 'blue'],
  [290, 'purple'],
  [345, 'magenta'],
  [360, 'red'],
];

// ── HSV ─────────────────────────────────────────

/** Hue (degrees, NaN when undefined) and saturation of an rgb triple. */
function hueSat(r: number, g: number, b: number): { hue: number; sat: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const sat = max > 0 ? d / max : 0;
  if (d <= 1e-9) return { hue: NaN, sat };
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return { hue: h < 0 ? h + 360 : h, sat };
}

/** Shortest arc covering all hues: the complement of the largest gap. */
function hueArc(hues: Float64Array): { min: number; max: number; width: number } {
  hues.sort();
  const n = hues.length;
  // Gap that wraps from the last hue back to the first.
  let gap = hues[0]! + 360 - hues[n - 1]!;
  let min = hues[0]!;
  let max = hues[n - 1]!;
  for (let i = 1; i < n; i++) {
    const g = hues[i]! - hues[i - 1]!;
    if (g > gap) {
      gap = g;
      min = hues[i]!;
      max = hues[i - 1]!;
    }
  }
  return { min, max, width: 360 - gap };
}

/** Named bucket of a mean hue. */
function hueName(h: number): ColorName {
  for (const [bound, name] of HUE_BUCKETS) if (h < bound) return name;
  return 'red';
}

// ── Color ───────────────────────────────────────

/** Color features over all frames of several rgb signals. */
export function analyzeColor(signals: Signal[]): Color {
  const hues: number[] = [];
  let sx = 0;
  let sy = 0;
  let satSum = 0;
  let satN = 0;
  for (const s of signals) {
    const [r, g, b] = s.comps;
    if (!r || !g || !b) continue;
    for (let f = 0; f < s.frames; f++) {
      const value = s.intensity[f]!;
      if (value <= HUE_MIN_VALUE) continue;
      const hs = hueSat(r[f]!, g[f]!, b[f]!);
      satSum += hs.sat;
      satN++;
      if (hs.sat < HUE_MIN_SAT || Number.isNaN(hs.hue)) continue;
      hues.push(hs.hue);
      const rad = (hs.hue * Math.PI) / 180;
      sx += Math.cos(rad);
      sy += Math.sin(rad);
    }
  }
  const value = rangeOf(signals.map(s => s.intensity));
  const satMean = satN > 0 ? satSum / satN : 0;
  let hue = { min: 0, max: 0, mean: 0 };
  let width = 0;
  if (hues.length > 0) {
    const arc = hueArc(Float64Array.from(hues));
    let m = (Math.atan2(sy, sx) * 180) / Math.PI;
    if (m < 0) m += 360;
    hue = { min: round4(arc.min), max: round4(arc.max), mean: round4(m) };
    width = arc.width;
  }
  // Name: dark → black, desaturated → white/gray, wide hue arc → mixed.
  let name: ColorName;
  if (value.mean < 0.05) name = 'black';
  else if (satMean < 0.15 || hues.length === 0) name = value.mean > 0.7 ? 'white' : 'gray';
  else if (width > 90) name = 'mixed';
  else name = hueName(hue.mean);
  return { hue, sat: { mean: round4(satMean) }, value, name };
}

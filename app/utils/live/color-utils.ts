import { resolvePreset } from '~/components/engine/composables/preset-resolve';
import type { Preset } from '~/utils/engine/preset-types';

export interface RGB { r: number; g: number; b: number }

/** Returns hue in 0–360, or null if the preset has no RGB color channels. */
export function getPresetDominantHue(presetId: string, savedPresets: Preset[]): number | null {
  const rgb = getPresetNaturalRGB(presetId, savedPresets);
  if (!rgb) return null;
  return rgbToHsv(rgb.r, rgb.g, rgb.b).h;
}

/**
 * The FIRST pixel's natural RGB triple in the preset's primary RGB category.
 * Used as the "reference" color for hue-rotation, wheel handle position, and
 * "is this preset natural?" comparisons. Multi-pixel fixtures have multiple
 * (R, G, B) triples per category — we take the first of each type so this is
 * pixel 0's color, not "the last pixel's".
 */
export function getPresetNaturalRGB(presetId: string, savedPresets: Preset[]): RGB | null {
  const preset = savedPresets.find(p => p.id === presetId);
  if (!preset) return null;
  const resolved = resolvePreset(preset, savedPresets);
  for (const cat of resolved.categories) {
    let r: number | null = null, g: number | null = null, b: number | null = null;
    for (const ch of cat.channels) {
      const v = ch.stepValues[0] ?? 0;
      if (ch.channelType === 'RED'   && r === null) r = v;
      if (ch.channelType === 'GREEN' && g === null) g = v;
      if (ch.channelType === 'BLUE'  && b === null) b = v;
      if (r !== null && g !== null && b !== null) break;
    }
    if (r !== null || g !== null || b !== null) return { r: r ?? 0, g: g ?? 0, b: b ?? 0 };
  }
  return null;
}

/** hsv ∈ ([0,360], [0,1], [0,1]) → rgb ∈ [0,255]³ */
export function hsvToRgb(h: number, s: number, v: number): RGB {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  v = Math.max(0, Math.min(1, v));
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r1 = 0, g1 = 0, b1 = 0;
  if (h < 60)        { r1 = c; g1 = x; b1 = 0; }
  else if (h < 120)  { r1 = x; g1 = c; b1 = 0; }
  else if (h < 180)  { r1 = 0; g1 = c; b1 = x; }
  else if (h < 240)  { r1 = 0; g1 = x; b1 = c; }
  else if (h < 300)  { r1 = x; g1 = 0; b1 = c; }
  else               { r1 = c; g1 = 0; b1 = x; }
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

/** rgb ∈ [0,255]³ → hsv ({ h: 0–360, s: 0–1, v: 0–1 }) */
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    h = max === r ? ((g - b) / d) % 6
      : max === g ? (b - r) / d + 2
      :             (r - g) / d + 4;
    h = h * 60;
    if (h < 0) h += 360;
  }
  return { h, s, v };
}

/**
 * Map an RGB to the nearest English color name. Achromatic colors (low
 * saturation or value) collapse to "White" / "Gray" / "Black". Otherwise picks
 * the closest of 12 hue buckets at 30° steps.
 */
const HUE_NAMES: { hue: number; name: string }[] = [
  { hue: 0,   name: 'Red' },
  { hue: 30,  name: 'Orange' },
  { hue: 60,  name: 'Yellow' },
  { hue: 90,  name: 'Lime' },
  { hue: 120, name: 'Green' },
  { hue: 150, name: 'Teal' },
  { hue: 180, name: 'Cyan' },
  { hue: 210, name: 'Azure' },
  { hue: 240, name: 'Blue' },
  { hue: 270, name: 'Violet' },
  { hue: 300, name: 'Magenta' },
  { hue: 330, name: 'Pink' },
];

export function colorNameFor(rgb: RGB): string {
  const { h, s, v } = rgbToHsv(rgb.r, rgb.g, rgb.b);
  if (v < 0.08) return 'Black';
  if (s < 0.12) return v > 0.85 ? 'White' : 'Gray';
  let best = HUE_NAMES[0]!;
  let bestDist = 360;
  for (const entry of HUE_NAMES) {
    const raw = Math.abs(h - entry.hue) % 360;
    const dist = Math.min(raw, 360 - raw);
    if (dist < bestDist) { bestDist = dist; best = entry; }
  }
  return best.name;
}

/**
 * N evenly spaced hues around the wheel.
 * - If a base RGB is given, slot 0 is exactly that color and the remaining
 *   slots are hue-rotated from its hue with the same saturation/value.
 * - Without a base, full saturation & value, starting at red (0°).
 */
export function autoColorPalette(n: number, base?: RGB): RGB[] {
  if (n <= 0) return [];
  if (!base) {
    return Array.from({ length: n }, (_, i) => hsvToRgb((i / n) * 360, 1, 1));
  }
  const { h, s, v } = rgbToHsv(base.r, base.g, base.b);
  // Treat low-saturation / low-value bases (gray/black) as a hint to use full vivid colours.
  const useS = s < 0.05 ? 1 : s;
  const useV = v < 0.05 ? 1 : v;
  return Array.from({ length: n }, (_, i) =>
    i === 0 ? { ...base } : hsvToRgb(h + (i / n) * 360, useS, useV),
  );
}

/** A stored color-variants entry: `null` = "use the active preset's natural RGB". */
export type ColorEntry = RGB | null;

/**
 * Pick the next color to append to a stored palette.
 * Strategy: collect all hues currently in use (including the preset's natural hue
 * for `null` slots), and place the new color at the midpoint of the largest gap
 * on the hue circle. Saturation/value follow the existing palette (or 1/1).
 */
export function nextAutoColor(existing: ColorEntry[], baseRGB: RGB | null): RGB {
  // Gather hues + a reference saturation/value from real entries.
  const hues: number[] = [];
  let refS = 1, refV = 1;
  let haveRef = false;
  for (const e of existing) {
    const rgb = e ?? baseRGB;
    if (!rgb) continue;
    const { h, s, v } = rgbToHsv(rgb.r, rgb.g, rgb.b);
    hues.push(((h % 360) + 360) % 360);
    if (!haveRef && (s > 0.05 || v > 0.05)) {
      refS = s < 0.05 ? 1 : s;
      refV = v < 0.05 ? 1 : v;
      haveRef = true;
    }
  }
  if (hues.length === 0) return hsvToRgb(0, 1, 1);
  hues.sort((a, b) => a - b);
  // Largest gap on the circle.
  let bestGap = 0, bestMid = 0;
  for (let i = 0; i < hues.length; i++) {
    const cur = hues[i]!;
    const next = i + 1 < hues.length ? hues[i + 1]! : hues[0]! + 360;
    const gap = next - cur;
    if (gap > bestGap) {
      bestGap = gap;
      bestMid = ((cur + gap / 2) % 360 + 360) % 360;
    }
  }
  return hsvToRgb(bestMid, refS, refV);
}

/**
 * Grow or trim a stored color-variants array to match a target slot count.
 * - Slot 0 is always `null` (preset-natural).
 * - Existing entries at indices 1..len-1 are preserved verbatim.
 * - Missing trailing slots are filled by repeatedly calling `nextAutoColor`.
 * - Extra trailing slots are dropped when shrinking.
 */
export function growColorVariants(
  current: ColorEntry[] | undefined,
  targetLen: number,
  baseRGB: RGB | null,
): ColorEntry[] {
  if (targetLen <= 0) return [];
  const out: ColorEntry[] = [null]; // slot 0 always preset-natural
  // Copy through user-set / previously generated entries up to targetLen.
  if (current) {
    for (let i = 1; i < Math.min(current.length, targetLen); i++) {
      out.push(current[i] ?? null);
    }
  }
  while (out.length < targetLen) {
    out.push(nextAutoColor(out, baseRGB));
  }
  return out;
}

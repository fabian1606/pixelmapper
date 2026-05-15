import { resolvePreset } from '~/components/engine/composables/preset-resolve';
import type { Preset } from '~/utils/engine/preset-types';

export interface RGB { r: number; g: number; b: number }

/** Returns hue in 0–360, or null if the preset has no RGB color channels. */
export function getPresetDominantHue(presetId: string, savedPresets: Preset[]): number | null {
  const rgb = getPresetNaturalRGB(presetId, savedPresets);
  if (!rgb) return null;
  return rgbToHsv(rgb.r, rgb.g, rgb.b).h;
}

/** First RGB triple found in the preset's color category, scaled 0–255. */
export function getPresetNaturalRGB(presetId: string, savedPresets: Preset[]): RGB | null {
  const preset = savedPresets.find(p => p.id === presetId);
  if (!preset) return null;
  const resolved = resolvePreset(preset, savedPresets);
  for (const cat of resolved.categories) {
    let r = 0, g = 0, b = 0, found = false;
    for (const ch of cat.channels) {
      const v = ch.stepValues[0] ?? 0;
      if (ch.channelType === 'RED')   { r = v; found = true; }
      if (ch.channelType === 'GREEN') { g = v; found = true; }
      if (ch.channelType === 'BLUE')  { b = v; found = true; }
    }
    if (found) return { r, g, b };
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

/** N evenly spaced hues around the wheel, full saturation & value. */
export function autoColorPalette(n: number): RGB[] {
  if (n <= 0) return [];
  return Array.from({ length: n }, (_, i) => hsvToRgb((i / n) * 360, 1, 1));
}

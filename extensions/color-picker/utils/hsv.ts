/**
 * HSV ↔ RGB conversion for the color wheel. All components normalized:
 * h ∈ [0, 360), s, v, r, g, b ∈ [0, 1].
 */
import type { RgbColor } from '@pixelmapper/extension-api';

/** HSV triple. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

/** Converts normalized RGB to HSV. */
export function rgbToHsv({ r, g, b }: RgbColor): Hsv {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** Converts HSV to normalized RGB. */
export function hsvToRgb({ h, s, v }: Hsv): RgbColor {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = v - c;
  return { r: rgb[0] + m, g: rgb[1] + m, b: rgb[2] + m };
}

/** CSS `rgb()` string of a normalized color. */
export function cssRgb({ r, g, b }: RgbColor): string {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

import type { RGB } from '~/utils/live/color-utils';
import { hsvToRgb, rgbToHsv } from '~/utils/live/color-utils';

// ── Color shift (live color variants) ─────────────────────────────────────────

/** Below this HSV saturation a sample counts as achromatic (white/gray/black). */
export const ACHROMATIC_EPS = 0.001;

/**
 * How a color override transforms every natural sample of a preset. Derived
 * once from (preset reference color → override color). It changes hue and
 * saturation only: brightness belongs to the preset's composition (dark
 * sparkle pixels stay dark, peaks stay peaks), so the override's own value
 * is ignored.
 */
export interface ColorShift {
  /** Hue delta in degrees added to every chromatic sample. */
  hueDelta: number;
  /** Factor applied to every chromatic sample's saturation (clamped to 1). */
  satScale: number;
  /**
   * Set when the reference is achromatic (the whole preset is white/gray):
   * samples are tinted to this hue/saturation instead, since a hue delta
   * relative to a gray reference is meaningless.
   */
  tint: { h: number; s: number } | null;
}

/**
 * Builds the shift that maps `reference` onto `override` in hue AND
 * saturation. Hue rotation alone can't reach white (saturation stays), so
 * the saturation ratio override.s / reference.s is applied as well: white
 * desaturates the whole composition.
 */
export function buildColorShift(reference: RGB, override: RGB): ColorShift {
  const ref = rgbToHsv(reference.r, reference.g, reference.b);
  const ov = rgbToHsv(override.r, override.g, override.b);
  if (ref.s < ACHROMATIC_EPS) {
    return { hueDelta: 0, satScale: 1, tint: { h: ov.h, s: ov.s } };
  }
  return { hueDelta: ov.h - ref.h, satScale: ov.s / ref.s, tint: null };
}

/** Applies a `ColorShift` to one natural RGB sample, keeping its HSV value. */
export function shiftSample(rgb: RGB, shift: ColorShift): RGB {
  const { h, s, v } = rgbToHsv(rgb.r, rgb.g, rgb.b);
  if (shift.tint) return hsvToRgb(shift.tint.h, shift.tint.s, v);
  // Achromatic samples in a colored preset (white peaks, black gaps) stay.
  if (s < ACHROMATIC_EPS) return { ...rgb };
  return hsvToRgb(h + shift.hueDelta, Math.min(1, s * shift.satScale), v);
}

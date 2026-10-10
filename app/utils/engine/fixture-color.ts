/**
 * Programmed base color of a fixture (plan M5.8, M7.3): RGB 0–1 from the
 * active chaser step of its color channels (RGB, else CMY inverted), or null
 * without a color system. Used for the recipe rule `hasColor` and the hue
 * strip's center.
 */
import type { Fixture } from './core/fixture';

/** Value 0–1 of the first channel of `type` at the active step, or null. */
function channelValue(f: Fixture, type: string): number | null {
  const ch = f.channels.find(c => c.type === type && !c.isFine);
  if (!ch) return null;
  const cfg = ch.chaserConfig;
  const v = cfg?.stepValues?.[Math.min(cfg.activeEditStep ?? 0, (cfg.stepValues?.length ?? 1) - 1)];
  return typeof v === 'number' ? v / 255 : 0;
}

/** Programmed RGB of a fixture, or null. */
export function fixtureBaseColor(f: Fixture): { r: number; g: number; b: number } | null {
  const r = channelValue(f, 'RED');
  const g = channelValue(f, 'GREEN');
  const b = channelValue(f, 'BLUE');
  if (r !== null && g !== null && b !== null) return { r, g, b };
  const c = channelValue(f, 'CYAN');
  const m = channelValue(f, 'MAGENTA');
  const y = channelValue(f, 'YELLOW');
  if (c !== null && m !== null && y !== null) return { r: 1 - c, g: 1 - m, b: 1 - y };
  return null;
}

/** Hue (degrees) and saturation (HSV, 0–1) of an RGB color. */
export function hueSat(c: { r: number; g: number; b: number }): { hue: number; sat: number } {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const d = max - min;
  if (d < 1e-6) return { hue: 0, sat: 0 };
  let h = max === c.r ? ((c.g - c.b) / d) % 6 : max === c.g ? (c.b - c.r) / d + 2 : (c.r - c.g) / d + 4;
  h *= 60;
  return { hue: h < 0 ? h + 360 : h, sat: max > 0 ? d / max : 0 };
}

/** True when the fixture shows a clearly saturated, lit color. */
export function hasSaturatedColor(f: Fixture): boolean {
  const c = fixtureBaseColor(f);
  return !!c && Math.max(c.r, c.g, c.b) > 0.05 && hueSat(c).sat > 0.2;
}

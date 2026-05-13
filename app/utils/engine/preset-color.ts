import type { Preset } from './preset-types';

const FALLBACK_COLOR = '#475569';

function toHexComponent(v: number): string {
  return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
}

/**
 * Resolve a preset's display color. Manual `preset.color` wins; otherwise
 * derive an RGB tint from the first `color`-category's RED/GREEN/BLUE channels.
 * Falls back to a neutral gray when no color information is available.
 */
export function getPresetMainColor(preset: Preset): string {
  if (preset.color) return preset.color;

  const colorCat = preset.categories.find(c => c.type === 'color');
  if (!colorCat) return FALLBACK_COLOR;

  let r = 0, g = 0, b = 0;
  let hasAny = false;
  for (const ch of colorCat.channels) {
    const v = ch.stepValues[0] ?? 0;
    if (ch.channelType === 'RED')   { r = Math.max(r, v); hasAny = true; }
    if (ch.channelType === 'GREEN') { g = Math.max(g, v); hasAny = true; }
    if (ch.channelType === 'BLUE')  { b = Math.max(b, v); hasAny = true; }
  }
  if (!hasAny) return FALLBACK_COLOR;

  return `#${toHexComponent(r)}${toHexComponent(g)}${toHexComponent(b)}`;
}

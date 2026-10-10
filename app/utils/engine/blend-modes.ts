/**
 * Blend mode names and explanations (shared by the card's blend select,
 * plan M10.2; formerly the category-wide Stacking select).
 */
import type { BlendMode } from './types';

/** Display names (established in the former Stacking select). */
export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
  add: 'Add', override: 'Override', multiply: 'Mask', max: 'Brighten', min: 'Darken',
};

/** One-paragraph explanation per mode. */
export const BLEND_MODE_DESCRIPTIONS: Record<BlendMode, string> = {
  add: 'Offsets from all modifiers are summed together. A modifier with strength 50 and another with strength 30 produce a combined swing of 80 % around the base.',
  override: 'This modifier fully replaces whatever came before it.',
  multiply: 'The result above is multiplied by this modifier. Best with a Pattern: off fixtures are dimmed toward black while on fixtures keep the previous modifiers intact.',
  max: 'The brighter value wins. Combines modifiers that should only boost brightness.',
  min: 'The darker value wins. Cuts brightness or creates shadow zones.',
};

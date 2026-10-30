import type { Preset } from '~/utils/engine/preset-types';
import { getPresetMainColor } from '~/utils/engine/preset-color';
import type { PresetHighlight } from '~/utils/sync/version-preview/highlight-types';

/**
 * Captions of the preset view of the hover preview (pure): what the preset
 * programs, in words, and its display colour (same rule as the sidebar).
 */

/** Category type → caption (English UI). */
const CATEGORY_LABELS: Record<string, string> = {
  color: 'Color',
  movement: 'Movement',
  beam: 'Beam',
  dimmer: 'Dimmer',
  other: 'Other',
};

/** Preset type → caption suffix. */
const TYPE_LABELS: Record<string, string> = {
  flash: 'Flash preset',
  overwrite: 'Overwrite preset',
};

/** "Color · Dimmer · 2 effects · 12 fixtures" (defensive against old snapshots). */
export function presetSummary(preset: Preset): string {
  const cats = Array.isArray(preset.categories) ? preset.categories.filter(c => c && typeof c === 'object') : [];
  const kinds = [...new Set(cats.filter(c => !c.isModifier).map(c => CATEGORY_LABELS[c.type] ?? 'Other'))];
  const effects = cats.reduce((n, c) => n + (Array.isArray(c.modifiers) ? c.modifiers.length : 0), 0);
  const fixtures = new Set(cats.flatMap(c => (Array.isArray(c.fixtureIds) ? c.fixtureIds.map(String) : []))).size;
  const parts = [...kinds];
  if (effects) parts.push(`${effects} ${effects === 1 ? 'effect' : 'effects'}`);
  parts.push(`${fixtures} ${fixtures === 1 ? 'fixture' : 'fixtures'}`);
  const type = TYPE_LABELS[preset.type ?? ''];
  return [type, ...parts].filter(Boolean).join(' · ');
}

/** Swatch colour (manual colour, else derived; neutral when it cannot be read). */
export function presetSwatch(preset: Preset): string {
  try {
    return getPresetMainColor({ ...preset, categories: Array.isArray(preset.categories) ? preset.categories : [] });
  }
  catch {
    return '#475569';
  }
}

/** "Added" / "Changed: name, content" headline of one preset highlight. */
export function presetStatusText(h: PresetHighlight): string {
  if (h.status === 'added') return 'Added';
  const fields = [...new Set(h.changedKeys.map(k => (k === 'categories' ? 'content' : k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase())))];
  return fields.length ? `Changed: ${fields.join(', ')}` : 'Changed';
}

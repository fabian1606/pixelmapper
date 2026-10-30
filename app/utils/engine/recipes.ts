/**
 * Recipes (plan M5.2, M5.8): manifest presets applied to instances, the
 * active recipe of an instance, and the recipe picked for a selection.
 */
import { defaultParams } from '@pixelmapper/plugin-toolchain/params';
import { clampArgs, getShape } from '@pixelmapper/plugin-toolchain/curve-shapes';
import { isShapeCurve, paramCanvasHint } from '@pixelmapper/extension-api';
import type { ContentPluginManifest, ManifestPreset } from '@pixelmapper/plugin-toolchain/types';
import type { ModifierInstance, SpeedConfig } from './types';
import { applyDistributionPatch } from './distribution/create';
import type { SelectionShape } from './distribution/selection-shape';
import { selectionDistribution } from './distribution/selection-defaults';

/** Deep equality of JSON values (key order independent). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object).filter(k => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter(k => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every(k => jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * The recipes a card shows: the manifest's presets, or one "Default" recipe
 * (the schema defaults) so every modifier has a preset bar.
 */
export function cardPresets(manifest: ContentPluginManifest): ManifestPreset[] {
  return manifest.presets?.length ? manifest.presets : [{ id: 'default', label: 'Default', params: {} }];
}

/** Params of a recipe: manifest defaults overlaid with the recipe's params. */
export function presetParams(manifest: ContentPluginManifest, preset: ManifestPreset): ModifierInstance['params'] {
  return { ...defaultParams(manifest.params), ...(JSON.parse(JSON.stringify(preset.params)) as ModifierInstance['params']) };
}

/**
 * Keys of the `point` params with a canvas handle (`ui.canvas: 'point'`)
 * that the recipe does not set. Like the distribution handle, these are
 * placements the user dragged on the canvas: a recipe changes the look, not
 * where the points are, unless it names them explicitly.
 */
function keptCanvasPoints(manifest: ContentPluginManifest, preset: ManifestPreset): string[] {
  return manifest.params
    .filter(p => p.type === 'point' && paramCanvasHint(p.ui)?.canvas === 'point' && !(p.key in preset.params))
    .map(p => p.key);
}

/**
 * The instance with a recipe applied: all params (except canvas points the
 * recipe does not name, see `keptCanvasPoints`), speed, distribution (fields
 * the recipe does not give are kept) and strength.
 */
export function applyPreset(m: ModifierInstance, manifest: ContentPluginManifest, preset: ManifestPreset): ModifierInstance {
  const params = presetParams(manifest, preset);
  for (const key of keptCanvasPoints(manifest, preset)) {
    if (m.params[key] !== undefined) params[key] = JSON.parse(JSON.stringify(m.params[key])) as ModifierInstance['params'][string];
  }
  return {
    ...m,
    params,
    speed: { ...m.speed, ...(preset.speed ?? {}) } as SpeedConfig,
    distribution: applyDistributionPatch(m.distribution, preset.distribution),
    strength: preset.strength ?? m.strength,
  };
}

/**
 * A recipe applied on a card (plan M5.2, risk table): like `applyPreset`, and
 * when the recipe changes the mode or the mirror flag the distribution is
 * placed on the current selection; otherwise the user's handle and order stay.
 */
export function applyPresetOnSelection(m: ModifierInstance, manifest: ContentPluginManifest, preset: ManifestPreset, shape?: SelectionShape): ModifierInstance {
  const next = applyPreset(m, manifest, preset);
  const changed = next.distribution.mode !== m.distribution.mode || !!next.distribution.order.mirror !== !!m.distribution.order.mirror;
  if (shape && changed) next.distribution = selectionDistribution(next.distribution, shape);
  return next;
}

/** Params with defaults filled in and programmatic curves' args completed (comparison form). */
function normalizedParams(manifest: ContentPluginManifest, params: ModifierInstance['params']): ModifierInstance['params'] {
  const out = { ...defaultParams(manifest.params), ...params };
  for (const def of manifest.params) {
    const v = out[def.key];
    if (def.type === 'curve' && isShapeCurve(v)) {
      const shape = getShape(v.shape);
      if (shape) out[def.key] = { shape: v.shape, args: clampArgs(shape, v.args) };
    }
  }
  return out;
}

/**
 * How well the instance's speed and distribution match a recipe (fields the
 * recipe sets). The spread (scope, mode) outweighs the minor fields, so
 * recipes with the same params but another spread (Odd/Even vs Halves) are
 * told apart.
 */
function setupScore(m: ModifierInstance, p: ManifestPreset): number {
  let score = 0;
  if (p.speed?.beatValue !== undefined && p.speed.beatValue === m.speed.beatValue) score++;
  const d = p.distribution ?? {};
  for (const k of ['scope', 'mode'] as const) if (d[k] !== undefined && d[k] === m.distribution[k]) score += 10;
  for (const k of ['withinOffset', 'reverse'] as const) if (d[k] !== undefined && d[k] === m.distribution[k]) score++;
  if (d.order?.mirror !== undefined && !!d.order.mirror === !!m.distribution.order.mirror) score++;
  return score;
}

/**
 * The recipe whose params equal the instance's params, or null ("Custom").
 * Recipes with the same params (e.g. Ring / Bar Chase) are told apart by
 * their speed and distribution.
 */
export function activePreset(m: ModifierInstance, manifest: ContentPluginManifest): ManifestPreset | null {
  const full = normalizedParams(manifest, m.params);
  // Canvas points a recipe does not name never make the instance "Custom".
  const matches = cardPresets(manifest).filter((p) => {
    const want = normalizedParams(manifest, presetParams(manifest, p));
    for (const key of keptCanvasPoints(manifest, p)) want[key] = full[key]!;
    return jsonEqual(want, full);
  });
  if (matches.length <= 1) return matches[0] ?? null;
  // A recipe that names the points matches more specifically than one that ignores them.
  const fewestKept = Math.min(...matches.map(p => keptCanvasPoints(manifest, p).length));
  const specific = matches.filter(p => keptCanvasPoints(manifest, p).length === fewestKept);
  return specific.reduce((best, p) => (setupScore(m, p) > setupScore(m, best) ? p : best));
}

/** Context of the recipe choice on add. */
export interface PresetContext {
  shape: SelectionShape;
  /** The fixtures have a color system (rgb). */
  hasColor: boolean;
}

/**
 * The recipe for a new instance (plan M5.8): the first whose `when` rule
 * matches the selection, else the `default: true` one, else the first.
 */
export function pickPreset(manifest: ContentPluginManifest, ctx: PresetContext): ManifestPreset | null {
  const presets = manifest.presets ?? [];
  const matches = (p: ManifestPreset) => {
    const w = p.when;
    if (!w) return false;
    if (w.kind && !w.kind.includes(ctx.shape.kind)) return false;
    if (w.multiHead !== undefined && w.multiHead !== ctx.shape.multiHead) return false;
    if (w.hasColor !== undefined && w.hasColor !== ctx.hasColor) return false;
    return true;
  };
  // Specific rules (multi-head, color) before plain kind rules.
  const score = (p: ManifestPreset) => (p.when!.multiHead !== undefined ? 2 : 0) + (p.when!.hasColor !== undefined ? 2 : 0) + (p.when!.kind ? 1 : 0);
  const ranked = presets.filter(matches).sort((a, b) => score(b) - score(a));
  return ranked[0] ?? presets.find(p => p.default) ?? presets[0] ?? null;
}

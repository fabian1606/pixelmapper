/**
 * Recipes (plan M5.2, M5.8): manifest presets applied to instances, the
 * active recipe of an instance, and the recipe picked for a selection.
 */
import { defaultParams } from '@pixelmapper/plugin-toolchain/params';
import type { ContentPluginManifest, ManifestPreset } from '@pixelmapper/plugin-toolchain/types';
import type { ModifierInstance, SpeedConfig } from './types';
import { applyDistributionPatch } from './distribution/create';
import type { SelectionShape } from './distribution/selection-shape';

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

/** Params of a recipe: manifest defaults overlaid with the recipe's params. */
export function presetParams(manifest: ContentPluginManifest, preset: ManifestPreset): ModifierInstance['params'] {
  return { ...defaultParams(manifest.params), ...(JSON.parse(JSON.stringify(preset.params)) as ModifierInstance['params']) };
}

/**
 * The instance with a recipe applied: all params, speed, distribution
 * (fields the recipe does not give are kept) and strength.
 */
export function applyPreset(m: ModifierInstance, manifest: ContentPluginManifest, preset: ManifestPreset): ModifierInstance {
  return {
    ...m,
    params: presetParams(manifest, preset),
    speed: { ...m.speed, ...(preset.speed ?? {}) } as SpeedConfig,
    distribution: applyDistributionPatch(m.distribution, preset.distribution),
    strength: preset.strength ?? m.strength,
  };
}

/** The recipe whose params equal the instance's params, or null ("Custom"). */
export function activePreset(m: ModifierInstance, manifest: ContentPluginManifest): ManifestPreset | null {
  const full = { ...defaultParams(manifest.params), ...m.params };
  return manifest.presets?.find(p => jsonEqual(presetParams(manifest, p), full)) ?? null;
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

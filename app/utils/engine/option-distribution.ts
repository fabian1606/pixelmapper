/**
 * Enum options that need a distribution (`optionDistribution` in the param
 * schema): when a param edit picks such an option, the instance's
 * distribution is patched too, and placed on the selection when the mode
 * changes (like a recipe).
 */
import type { ParamValue } from '@pixelmapper/extension-api';
import type { ContentPluginManifest } from '@pixelmapper/plugin-toolchain/types';
import type { Distribution } from './types';
import { applyDistributionPatch } from './distribution/create';
import type { SelectionShape } from './distribution/selection-shape';
import { selectionDistribution } from './distribution/selection-defaults';

/**
 * The distribution after a param edit, or null when no newly picked option
 * asks for one (or the distribution already matches).
 */
export function distributionForParams(
  manifest: ContentPluginManifest,
  before: Record<string, ParamValue>,
  after: Record<string, ParamValue>,
  d: Distribution,
  shape?: SelectionShape,
): Distribution | null {
  let next = d;
  for (const p of manifest.params) {
    if (p.type !== 'enum' || !p.optionDistribution) continue;
    const v = after[p.key];
    if (v === before[p.key] || typeof v !== 'string') continue;
    const patch = p.optionDistribution[v];
    if (patch) next = applyDistributionPatch(next, patch);
  }
  if (next === d || (next.mode === d.mode && next.scope === d.scope && next.withinOffset === d.withinOffset)) return null;
  return shape && next.mode !== d.mode ? selectionDistribution(next, shape) : next;
}

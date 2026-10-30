import { deepEqual, isPlainObject } from '~/utils/sync/merge/values';
import { type Entity, type EntitySpec, humanize } from './compare';
import type { DiffOptions } from './types';

/**
 * Comparison specs of the flat entity lists of a snapshot: modifiers
 * (effects), saved presets and live pages.
 */

/** Name field as a string. */
const nameOf = (e: Entity) => (typeof e.name === 'string' ? e.name : undefined);

// ── Modifiers ────────────────────────────────────────────────────────────────

/** Changed plugin params, one label per param key ("color", "wave shape"). */
function paramLabels(prev: Entity, next: Entity): string[] {
  const a = isPlainObject(prev.params) ? prev.params : {};
  const b = isPlainObject(next.params) ? next.params : {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter(k => !deepEqual(a[k], b[k])).map(humanize);
}

/** Modifier spec; names come from `options.modifierName` (manifests are not in the snapshot). */
export function modifierSpec(options: DiffOptions): EntitySpec {
  return {
    name: e => options.modifierName?.(e) ?? nameOf(e),
    fields: {
      plugin: 'effect type',
      signature: 'effect type',
      targetChannels: 'channels',
      targetFixtureIds: 'fixtures',
      blendMode: 'blend mode',
      strength: 'strength',
      speed: 'speed',
      distribution: 'distribution',
    },
    ignore: ['id'],
    customKeys: ['params'],
    custom: paramLabels,
  };
}

// ── Presets ──────────────────────────────────────────────────────────────────

export const PRESET_SPEC: EntitySpec = {
  name: nameOf,
  fields: {
    name: 'name',
    categories: 'content',
    type: 'type',
    overwriteTarget: 'type',
    color: 'color',
    basePresetId: 'base preset',
  },
  // `createdAt` changes with every overwrite; the content change is reported instead.
  ignore: ['id', 'createdAt'],
};

// ── Live pages ───────────────────────────────────────────────────────────────

export const LIVE_PAGE_SPEC: EntitySpec = {
  name: nameOf,
  fields: {
    name: 'name',
    columns: 'layout',
    aspectRatioW: 'layout',
    aspectRatioH: 'layout',
    gridSize: 'layout',
    backgroundColor: 'background',
    widgets: 'widgets',
    sections: 'sections',
  },
  ignore: ['id'],
};

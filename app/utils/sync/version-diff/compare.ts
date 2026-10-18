import { deepEqual, isPlainObject } from '~/utils/sync/merge/values';
import type { EntityChange, EntityRef, KindDiff } from './types';

/**
 * Generic id-keyed comparison of two entity lists (same idea as
 * `merge/merge-entity-lists.ts`, without a base): entities are matched by
 * id, field changes are translated to human labels through a field map.
 */

/** A JSON object entity. */
export type Entity = Record<string, unknown>;

/** How to compare one kind of entity. */
export interface EntitySpec {
  /** Display name; falls back to the id. */
  name: (e: Entity) => string | undefined;
  /** Field key → human label. Unlisted keys use `humanize(key)`. */
  fields: Record<string, string>;
  /** Keys never reported (ids, UI state, timestamps…). */
  ignore?: readonly string[];
  /** Keys compared by `custom` instead of the field map. */
  customKeys?: readonly string[];
  /** Extra labels for `customKeys` (called with both versions). */
  custom?: (prev: Entity, next: Entity) => string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Stable string key of an entity id; null when the id is unusable. */
export function idKey(value: unknown): string | null {
  if (typeof value === 'string' && value) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** "fixturePosition" → "fixture position". */
export function humanize(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
}

/** Objects of an unknown value that is supposed to be an array. */
export function entities(value: unknown): Entity[] {
  return Array.isArray(value) ? value.filter(isPlainObject) : [];
}

/** id → entity (first one wins on duplicate ids), in list order. */
export function byId(list: Entity[], idOf: (e: Entity) => unknown = e => e.id): Map<string, Entity> {
  const map = new Map<string, Entity>();
  for (const e of list) {
    const key = idKey(idOf(e));
    if (key !== null && !map.has(key)) map.set(key, e);
  }
  return map;
}

/** Labels of the keys whose values differ, in field-map order, deduplicated. */
export function changedFields(prev: Entity, next: Entity, spec: EntitySpec): string[] {
  const skip = new Set([...(spec.ignore ?? []), ...(spec.customKeys ?? [])]);
  const keys = new Set([...Object.keys(spec.fields), ...Object.keys(prev), ...Object.keys(next)]);
  const labels: string[] = [];
  for (const key of keys) {
    if (skip.has(key) || deepEqual(prev[key], next[key])) continue;
    labels.push(spec.fields[key] ?? humanize(key));
  }
  if (spec.custom) labels.push(...spec.custom(prev, next));
  return [...new Set(labels)];
}

/** True when the ids present in both maps appear in a different order. */
export function orderChanged(prev: Map<string, Entity>, next: Map<string, Entity>): boolean {
  const a = [...prev.keys()].filter(k => next.has(k));
  const b = [...next.keys()].filter(k => prev.has(k));
  return a.some((k, i) => k !== b[i]);
}

/** Display ref of an entity. */
function ref(id: string, e: Entity, spec: EntitySpec): EntityRef {
  const name = spec.name(e);
  return { id, name: name && name.trim() ? name : id };
}

// ── Diff ─────────────────────────────────────────────────────────────────────

/** Compares two id → entity maps (as returned by `byId`). */
export function diffMaps(prev: Map<string, Entity>, next: Map<string, Entity>, spec: EntitySpec): KindDiff {
  const added: EntityRef[] = [];
  const removed: EntityRef[] = [];
  const changed: EntityChange[] = [];
  for (const [id, e] of next) {
    const old = prev.get(id);
    if (!old) {
      added.push(ref(id, e, spec));
      continue;
    }
    const fields = changedFields(old, e, spec);
    if (!fields.length) continue;
    const change: EntityChange = { ...ref(id, e, spec), fields };
    const oldName = ref(id, old, spec).name;
    if (oldName !== change.name) change.previousName = oldName;
    changed.push(change);
  }
  for (const [id, e] of prev) {
    if (!next.has(id)) removed.push(ref(id, e, spec));
  }
  return { added, removed, changed, reordered: orderChanged(prev, next) };
}

/** Compares two entity lists matched by `id`. */
export function diffLists(prev: unknown, next: unknown, spec: EntitySpec): KindDiff {
  return diffMaps(byId(entities(prev)), byId(entities(next)), spec);
}

/** True when a kind has no changes. */
export function isEmptyKind(d: KindDiff): boolean {
  return !d.added.length && !d.removed.length && !d.changed.length && !d.reordered;
}

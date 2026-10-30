import type { MergeOptions, MergeResult } from './types';
import { childContext, rootContext, type MergeContext } from './context';
import { deepClone, deepEqual, definedKeys, isPlainObject } from './values';
import { isEntityList, mergeEntityListsIn } from './merge-entity-lists';

/**
 * Field-level 3-way merge of arbitrary JSON-like values (ADR 0004 §3.3).
 *
 * Rules:
 * - changed on one side only → that side wins;
 * - changed on both sides to the same value → that value;
 * - changed on both sides differently:
 *   - plain objects merge recursively per key,
 *   - arrays whose elements all carry an id merge as entity lists,
 *   - everything else (primitives, arrays of primitives, arrays without ids)
 *     is atomic: local wins and a `modify-modify` conflict is reported.
 *
 * `undefined` means "absent" on every side, so deleting a key is a change too.
 */

// ── Internal recursion ───────────────────────────────────────────────────────

/** Merge one value; conflicts are pushed into `ctx.conflicts`. */
export function mergeValuesIn(base: unknown, local: unknown, remote: unknown, ctx: MergeContext): unknown {
  // Both sides agree (incl. "nobody changed it").
  if (deepEqual(local, remote)) return deepClone(local);
  // Only one side changed → take it.
  if (deepEqual(base, local)) return deepClone(remote);
  if (deepEqual(base, remote)) return deepClone(local);

  // Both changed differently: recurse into structured values where possible.
  if (isPlainObject(local) && isPlainObject(remote)) {
    return mergeObjectsIn(isPlainObject(base) ? base : {}, local, remote, ctx);
  }
  if (Array.isArray(local) && Array.isArray(remote)) {
    const baseList = Array.isArray(base) ? base : [];
    if (isEntityList([baseList, local, remote], ctx.idKey)) {
      return mergeEntityListsIn(baseList, local, remote, ctx);
    }
  }

  // Atomic true conflict: local wins.
  ctx.conflicts.push({
    entityId: ctx.entityId,
    path: ctx.path,
    base: deepClone(base),
    local: deepClone(local),
    remote: deepClone(remote),
    kind: 'modify-modify',
  });
  return deepClone(local);
}

/** Merge two plain objects key by key against their ancestor. */
export function mergeObjectsIn(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
  ctx: MergeContext,
): Record<string, unknown> {
  // Key order: local keys first, then keys only remote (or base) knows.
  const keys = new Set([...definedKeys(local), ...definedKeys(remote), ...definedKeys(base)]);
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const merged = mergeValuesIn(base[key], local[key], remote[key], childContext(ctx, key));
    if (merged !== undefined) out[key] = merged;
  }
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * 3-way merge of any JSON-like value. `base` is the common ancestor,
 * `local` the pending (offline) version, `remote` the server version.
 * The result never aliases the inputs.
 */
export function mergeValues<T>(base: unknown, local: T, remote: T, options?: MergeOptions): MergeResult<T> {
  const ctx = rootContext(options);
  const value = mergeValuesIn(base, local, remote, ctx) as T;
  return { value, conflicts: ctx.conflicts };
}

/**
 * 3-way merge of plain objects (ADR 0004 §3.3). `base` may be `undefined`
 * (object created independently on both sides). Nested plain objects merge
 * recursively; nested arrays of entities (elements carrying `idKey`) merge as
 * entity lists; other arrays are atomic.
 */
export function mergeObjects<T extends Record<string, unknown>>(
  base: Record<string, unknown> | undefined,
  local: T,
  remote: T,
  options?: MergeOptions,
): MergeResult<T> {
  const ctx = rootContext(options);
  const value = mergeObjectsIn(base ?? {}, local, remote, ctx) as T;
  return { value, conflicts: ctx.conflicts };
}

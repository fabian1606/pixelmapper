import type { EntityId, MergeOptions, MergeResult } from './types';
import { childContext, rootContext, type MergeContext } from './context';
import { deepClone, deepEqual, isEntityId, isPlainObject } from './values';
import { mergeValuesIn } from './merge-values';
import { mergeOrder } from './merge-order';

/**
 * 3-way merge of lists of entities identified by an id field (ADR 0004 §3.3).
 *
 * Per id:
 * - added on one side → kept; added on both → field merge (base = `{}`);
 * - removed on one side, untouched on the other → removed;
 * - removed on one side, modified on the other → kept with the modification,
 *   `remove-modify` conflict;
 * - present everywhere → field merge (local wins on true conflicts).
 * Order: see `merge-order.ts`.
 *
 * Lists that are not valid entity lists (element without a usable id, or a
 * duplicate id) are merged atomically instead.
 */

// ── Detection ────────────────────────────────────────────────────────────────

/** Index a list by id; `null` if an element has no valid id or ids repeat. */
function indexById(list: unknown[], idKey: string): Map<EntityId, unknown> | null {
  const map = new Map<EntityId, unknown>();
  for (const item of list) {
    if (!isPlainObject(item)) return null;
    const id = item[idKey];
    if (!isEntityId(id) || map.has(id)) return null;
    map.set(id, item);
  }
  return map;
}

/**
 * True if the given lists together form a mergeable entity list: at least one
 * element overall, every element a plain object with a unique valid id.
 */
export function isEntityList(lists: unknown[][], idKey: string): boolean {
  let total = 0;
  for (const list of lists) {
    if (!indexById(list, idKey)) return false;
    total += list.length;
  }
  return total > 0;
}

// ── Internal recursion ───────────────────────────────────────────────────────

/** Atomic fallback for lists that cannot be merged by id. */
function mergeAtomic(base: unknown, local: unknown, remote: unknown, ctx: MergeContext): unknown {
  if (deepEqual(local, remote) || deepEqual(base, remote)) return deepClone(local);
  if (deepEqual(base, local)) return deepClone(remote);
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

/** Merge one entity list; conflicts are pushed into `ctx.conflicts`. */
export function mergeEntityListsIn(base: unknown[], local: unknown[], remote: unknown[], ctx: MergeContext): unknown[] {
  const b = indexById(base, ctx.idKey);
  const l = indexById(local, ctx.idKey);
  const r = indexById(remote, ctx.idKey);
  if (!b || !l || !r) return mergeAtomic(base, local, remote, ctx) as unknown[];

  const merged = new Map<EntityId, unknown>();
  const ids = new Set<EntityId>([...b.keys(), ...l.keys(), ...r.keys()]);
  for (const id of ids) {
    const entityCtx = childContext(ctx, id, id);
    const inB = b.has(id);
    const inL = l.has(id);
    const inR = r.has(id);
    const bv = b.get(id);
    const lv = l.get(id);
    const rv = r.get(id);

    if (inL && inR) {
      // Present on both sides (or added on both) → field merge.
      merged.set(id, mergeValuesIn(inB ? bv : {}, lv, rv, entityCtx));
    } else if (!inB) {
      // Added on exactly one side → keep.
      merged.set(id, deepClone(inL ? lv : rv));
    } else if (inL || inR) {
      // Removed on one side: drop if the other side left it untouched.
      const survivor = inL ? lv : rv;
      if (deepEqual(bv, survivor)) continue;
      merged.set(id, deepClone(survivor));
      ctx.conflicts.push({
        entityId: id,
        path: entityCtx.path,
        base: deepClone(bv),
        local: deepClone(lv),
        remote: deepClone(rv),
        kind: 'remove-modify',
      });
    }
    // Removed on both sides → gone.
  }

  const order = mergeOrder([...b.keys()], [...l.keys()], [...r.keys()], new Set(merged.keys()), ctx);
  return order.map(id => merged.get(id));
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * 3-way merge of entity lists keyed by `options.idKey` (default `'id'`).
 * Ids may be strings or numbers (`1` and `'1'` are different ids).
 * The result never aliases the inputs.
 */
export function mergeEntityLists<T>(
  base: readonly T[] | undefined,
  local: readonly T[],
  remote: readonly T[],
  options?: MergeOptions,
): MergeResult<T[]> {
  const ctx = rootContext(options);
  const value = mergeEntityListsIn([...(base ?? [])], [...local], [...remote], ctx) as T[];
  return { value, conflicts: ctx.conflicts };
}

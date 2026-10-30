import type { EntityId } from './types';
import type { MergeContext } from './context';

/**
 * Ordering rule of entity-list merges (ADR 0004 §3.3):
 * "remote order, with local-only additions inserted after their local
 * predecessor".
 *
 * Refinement (documented in `architecture/offline/wp-merge.md`): the relative
 * order of entities present on all three sides is itself treated like a field.
 * If only the local side reordered them, the local order is the skeleton
 * (otherwise an offline reorder would silently be dropped). If both sides
 * reordered them differently, local wins and an `order` conflict is reported.
 * In every other case the remote order is the skeleton, as the ADR states.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/** `list` restricted to ids contained in `keep`, order preserved. */
function filterIds(list: EntityId[], keep: Set<EntityId>): EntityId[] {
  return list.filter(id => keep.has(id));
}

/** Order-sensitive equality of two id sequences. */
function sameSequence(a: EntityId[], b: EntityId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Insert every id of `kept` missing from `result` after its nearest
 * predecessor in `source` that is already placed (or at the front).
 * Processing in source order keeps consecutive insertions in sequence.
 */
function insertMissing(result: EntityId[], source: EntityId[], kept: Set<EntityId>): void {
  const placed = new Set(result);
  source.forEach((id, index) => {
    if (!kept.has(id) || placed.has(id)) return;
    let at = 0;
    for (let i = index - 1; i >= 0; i--) {
      const pos = result.indexOf(source[i]!);
      if (pos !== -1) { at = pos + 1; break; }
    }
    result.splice(at, 0, id);
    placed.add(id);
  });
}

// ── Public (module) API ──────────────────────────────────────────────────────

/**
 * Final id order of a merged entity list.
 * `kept` is the set of ids that survive the merge; every kept id appears in
 * `local` or `remote`.
 */
export function mergeOrder(
  base: EntityId[],
  local: EntityId[],
  remote: EntityId[],
  kept: Set<EntityId>,
  ctx: MergeContext,
): EntityId[] {
  // Relative order of the entities all three sides share.
  const localSet = new Set(local);
  const remoteSet = new Set(remote);
  const common = new Set(base.filter(id => localSet.has(id) && remoteSet.has(id)));
  const baseCommon = filterIds(base, common);
  const localCommon = filterIds(local, common);
  const remoteCommon = filterIds(remote, common);
  const localReordered = !sameSequence(baseCommon, localCommon);
  const remoteReordered = !sameSequence(baseCommon, remoteCommon);

  let useLocal = localReordered && !remoteReordered;
  if (localReordered && remoteReordered && !sameSequence(localCommon, remoteCommon)) {
    // True ordering conflict: local wins (ADR D4).
    useLocal = true;
    ctx.conflicts.push({
      entityId: ctx.entityId,
      path: ctx.path,
      base: baseCommon,
      local: localCommon,
      remote: remoteCommon,
      kind: 'order',
    });
  }

  const skeleton = useLocal ? local : remote;
  const other = useLocal ? remote : local;
  const result = filterIds(skeleton, kept);
  insertMissing(result, other, kept);
  return result;
}

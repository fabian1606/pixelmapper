import type { EntityId, MergeConflict, MergeOptions, MergePath } from './types';

/**
 * Internal recursion state shared by `mergeValues`, `mergeObjects` and
 * `mergeEntityLists`. Not part of the public API.
 */

// ── Context ──────────────────────────────────────────────────────────────────

export interface MergeContext {
  /** Entity id field (see `MergeOptions.idKey`). */
  idKey: string;
  /** Sink for all conflicts of the current merge run. */
  conflicts: MergeConflict[];
  /** Innermost enclosing entity, `null` at the root. */
  entityId: EntityId | null;
  /** Path of the value being merged, relative to the merge root. */
  path: MergePath;
}

/** Default id field of entity lists. */
export const DEFAULT_ID_KEY = 'id';

/** Fresh root context for a public merge call. */
export function rootContext(options: MergeOptions | undefined): MergeContext {
  return {
    idKey: options?.idKey ?? DEFAULT_ID_KEY,
    conflicts: [],
    entityId: null,
    path: [],
  };
}

/** Child context one path segment deeper (optionally entering an entity). */
export function childContext(ctx: MergeContext, segment: EntityId, entityId?: EntityId): MergeContext {
  return {
    idKey: ctx.idKey,
    conflicts: ctx.conflicts,
    entityId: entityId ?? ctx.entityId,
    path: [...ctx.path, segment],
  };
}

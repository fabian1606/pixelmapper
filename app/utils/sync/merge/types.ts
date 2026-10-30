/**
 * Shared types of the generic 3-way merge (ADR 0004 D4, §3.3).
 *
 * The merge is pure data: it never touches Vue, Pinia or Supabase and works
 * on plain JSON-like values (objects, arrays, primitives).
 */

// ── Ids & paths ──────────────────────────────────────────────────────────────

/** Entity id as used in project data (fixtures may still carry numeric ids). */
export type EntityId = string | number;

/**
 * Location of a conflicting value, relative to the merge root. Object keys
 * are strings; elements of entity lists are addressed by their id.
 */
export type MergePath = EntityId[];

// ── Conflicts ────────────────────────────────────────────────────────────────

/**
 * Kind of a reported conflict:
 * - `modify-modify`: the same field was changed on both sides to different
 *   values (local wins).
 * - `remove-modify`: an entity was removed on one side and modified on the
 *   other (the entity is kept with the modification).
 * - `order`: both sides reordered the same entities differently (local order
 *   wins).
 */
export type MergeConflictKind = 'modify-modify' | 'remove-modify' | 'order';

/** A true conflict detected (and already resolved) by the merge. */
export interface MergeConflict {
  /** Innermost entity containing the conflict, `null` outside entity lists. */
  entityId: EntityId | null;
  /** Path of the conflicting value relative to the merge root. */
  path: MergePath;
  /** Value in the common ancestor (`undefined` = absent). */
  base: unknown;
  /** Local (pending) value — this is what the merge kept, except for `remove-modify`. */
  local: unknown;
  /** Remote (server) value. */
  remote: unknown;
  kind: MergeConflictKind;
}

// ── Results & options ────────────────────────────────────────────────────────

/** Result of a merge: a fresh value (never aliasing inputs) plus conflicts. */
export interface MergeResult<T> {
  value: T;
  conflicts: MergeConflict[];
}

/** Options of the merge functions. */
export interface MergeOptions {
  /**
   * Field holding the entity id in entity lists. Also used to auto-detect
   * nested entity lists (arrays whose elements all carry this key).
   * Default: `'id'`.
   */
  idKey?: string;
}

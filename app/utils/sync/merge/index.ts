import { registerBuiltinRebaseAdapters } from './adapters';

/**
 * Generic 3-way merge + rebase adapters for offline sync (ADR 0004 D4, D7,
 * §3.2, §3.3). Pure TypeScript: no Vue, Pinia or Supabase.
 *
 * Importing this module registers the built-in adapters for every persisted
 * command and persistent live-op. Unknown types pass through unchanged.
 */

// ── Core merge ───────────────────────────────────────────────────────────────

export type { EntityId, MergeConflict, MergeConflictKind, MergeOptions, MergePath, MergeResult } from './types';
export { mergeObjects, mergeValues } from './merge-values';
export { mergeEntityLists } from './merge-entity-lists';
export { deepClone, deepEqual, isPlainObject } from './values';

// ── Rebase adapters ──────────────────────────────────────────────────────────

export type { PendingChange, RebaseAdapter, RebaseContext, RebaseResult, RebaseState } from './adapters/registry';
export {
  getRebaseAdapter,
  listRebaseAdapterTypes,
  passThroughAdapter,
  rebaseChange,
  registerRebaseAdapter,
} from './adapters/registry';
export { registerBuiltinRebaseAdapters } from './adapters';

registerBuiltinRebaseAdapters();

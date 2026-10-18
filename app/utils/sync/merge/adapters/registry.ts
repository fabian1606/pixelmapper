import type { ProjectSnapshot } from '~/utils/engine/serialize';
import type { MergeConflict } from '../types';
import { deepClone } from '../values';

/**
 * Rebase adapters (ADR 0004 D7, §3.2 step 4.3).
 *
 * A pending change (history command or persistent live-op) was recorded
 * against the *local* state. After pulling remote changes, the sync engine
 * asks the adapter for that change type to transform the payload so it is
 * valid against the *current* state (new base + already rebased pending
 * changes) and does not wipe concurrent remote work when replayed.
 *
 * Adapters are pure data transforms: they read plain project state and never
 * touch the engine store, Vue or Supabase.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Plain project state an adapter rebases against (a `ProjectSnapshot`). */
export type RebaseState = ProjectSnapshot;

/** A pending change as stored in the outbox. */
export interface PendingChange {
  /** `commandType` (history commands) or live-op type. */
  type: string;
  payload: unknown;
  kind?: 'command' | 'live-op';
}

/** Input of an adapter. */
export interface RebaseContext {
  /** State the rebased change will be applied to. */
  current: RebaseState;
  /**
   * Optional: local state the change was originally applied to (old base +
   * earlier pending changes). Lets adapters of after-only payloads
   * (`modifier.sync`, deletes, absolute patches) tell remote modifications
   * apart from local ones. Adapters MUST work without it.
   */
  previous?: RebaseState;
}

/** Output of an adapter. */
export interface RebaseResult {
  /** Rebased payload (fresh object, never aliasing the input). */
  payload: unknown;
  /** True conflicts detected while rebasing (local won unless noted). */
  conflicts: MergeConflict[];
  /**
   * Set when the change must be dropped (e.g. its target no longer exists).
   * The value is a human-readable reason. `payload` is then the input copy.
   */
  skipped?: string;
}

/** Transforms one pending payload against the current state. */
export type RebaseAdapter = (payload: any, ctx: RebaseContext) => RebaseResult;

// ── Registry ─────────────────────────────────────────────────────────────────

const adapters = new Map<string, RebaseAdapter>();

/** Register (or replace) the adapter of a change type. */
export function registerRebaseAdapter(type: string, adapter: RebaseAdapter): void {
  adapters.set(type, adapter);
}

/** Adapter registered for `type`, if any. */
export function getRebaseAdapter(type: string): RebaseAdapter | undefined {
  return adapters.get(type);
}

/** All change types with a registered adapter (diagnostics / tests). */
export function listRebaseAdapterTypes(): string[] {
  return [...adapters.keys()].sort();
}

/**
 * Default for unknown types (e.g. extension commands `'<ext>/<name>'`):
 * pass the payload through unchanged. Such changes are replayed as recorded,
 * which is safe for additive or by-id changes and the same behaviour as
 * before offline sync existed.
 */
export const passThroughAdapter: RebaseAdapter = payload => ({
  payload: deepClone(payload),
  conflicts: [],
});

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Rebase one pending change onto `current`. Pending changes MUST be rebased
 * in outbox order, each against the state that already contains the
 * previously rebased ones. Never throws: a failing adapter falls back to
 * pass-through (logged).
 */
export function rebaseChange(change: PendingChange, current: RebaseState, previous?: RebaseState): RebaseResult {
  const adapter = adapters.get(change.type) ?? passThroughAdapter;
  try {
    return adapter(deepClone(change.payload), { current, previous });
  }
  catch (err) {
    console.warn(`[merge] rebase adapter for '${change.type}' failed, passing change through:`, err);
    return passThroughAdapter(change.payload, { current, previous });
  }
}

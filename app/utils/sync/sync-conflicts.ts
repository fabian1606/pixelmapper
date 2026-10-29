import type { ProjectSnapshot } from '~/utils/engine/serialize';
import type { MergeConflict } from '~/utils/sync/merge';

/**
 * Conflict reporting between the sync engine and the UI (ADR 0004 D4, D5, D17).
 *
 * After a rebase that produced true conflicts (local value won), the sync
 * engine calls `reportSyncConflicts`. The UI (conflict toast) subscribes via
 * `onSyncConflicts`, lists the conflicts in human terms and offers
 * "Restore state before sync", which calls `report.restore()`.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** One conflict together with the change type that produced it. */
export interface SyncConflictItem {
  /** `commandType` or live-op type of the rebased pending change. */
  changeType: string;
  conflict: MergeConflict;
}

/** Everything the UI needs to show the conflict toast. */
export interface SyncConflictReport {
  projectId: string;
  items: SyncConflictItem[];
  /** State after the rebase; used to resolve entity ids to names. */
  state: ProjectSnapshot;
  /**
   * Whether a `before offline sync` server snapshot exists for this rebase
   * (D5). When false, `restore` is unavailable.
   */
  canRestore: boolean;
  /**
   * Restores the `before offline sync` snapshot and reloads the project.
   * Resolves true on success; never throws.
   */
  restore: () => Promise<boolean>;
}

/** Listener signature. */
export type SyncConflictListener = (report: SyncConflictReport) => void;

// ── Registry ─────────────────────────────────────────────────────────────────

const listeners = new Set<SyncConflictListener>();

/** Subscribe to conflict reports; returns an unsubscribe function. */
export function onSyncConflicts(cb: SyncConflictListener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Called by the sync engine after a rebase with conflicts. */
export function reportSyncConflicts(report: SyncConflictReport): void {
  if (report.items.length === 0) return;
  // Without a UI listener the conflicts would be lost silently: log them.
  if (listeners.size === 0) console.warn('[sync] conflicts (no UI listener):', report.items);
  for (const cb of listeners) {
    try { cb(report); }
    catch (err) { console.warn('[sync] conflict listener failed:', err); }
  }
}

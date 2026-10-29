import type { ProjectSnapshot } from '~/utils/engine/serialize';

/**
 * Port between the sync engine and the live project state (ADR 0004 §3.2).
 *
 * The sync engine never models project state itself: it computes base,
 * rebased and working states by applying snapshots and replaying changes
 * through the same code paths that load a project (snapshot apply + command /
 * live-op replay registry). The engine-store implements this port; tests use
 * a small fake.
 */

/** A change to replay (server row, outbox row or rebased payload). */
export interface ReplayableChange {
  /** `commandType` or live-op type. */
  type: string;
  payload: unknown;
  /** Author (live-op handlers may use it); empty for local changes. */
  userId?: string;
}

export interface ProjectStatePort {
  /** Plain (JSON-safe, non-aliased) snapshot of the live state. */
  capture(): ProjectSnapshot;
  /** Replace the live state with `snapshot` (may throw `IncompatibleProjectError`). */
  apply(snapshot: ProjectSnapshot): void;
  /**
   * Apply one change to the live state without persisting or broadcasting
   * it. Returns false when no handler exists for the type.
   */
  replay(change: ReplayableChange): boolean;
}

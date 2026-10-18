import type { SyncDeps, SyncState } from '~/utils/sync/sync-context';

/**
 * Realtime (CDC) intake of the sync engine (ADR 0004 §3.2): the fast path
 * for `project_changes` inserts. Rows are deduplicated by change id against
 * the live sync position and this tab's own pushes, recorded (so pulls skip
 * them) and foreign ones handed to the collaboration applier.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** A realtime `project_changes` insert. */
export interface RemoteInsert {
  sequenceNumber: number;
  changeId: string;
  userId: string;
  commandType: string;
  payload: unknown;
}

/** Applies a realtime insert to the live state (commands via history). */
export type RemoteApplier = (row: RemoteInsert) => void;

// ── Intake ───────────────────────────────────────────────────────────────────

export class RealtimeIntake {
  private deferred: RemoteInsert[] = [];
  private applier: RemoteApplier | null = null;

  /** `state()` is read per row: a rebase replaces the live position. */
  constructor(private readonly state: () => SyncState, private readonly deps: SyncDeps) {}

  /** Set (or clear) the collaboration applier. */
  setApplier(fn: RemoteApplier | null): void {
    this.applier = fn;
  }

  /** Handle a row now, or keep it until `drain()` while a cycle runs. */
  handle(row: RemoteInsert, defer: boolean): void {
    if (defer) { this.deferred.push(row); return; }
    this.process(row);
  }

  /** Process rows that arrived during a cycle. */
  drain(): void {
    for (const row of this.deferred.splice(0)) this.process(row);
  }

  /** Apply one row unless it is reflected already or our own. */
  private process(row: RemoteInsert): void {
    const { changeId, sequenceNumber } = row;
    if (!changeId) return;
    const state = this.state();
    const known = state.live.reflects(changeId, sequenceNumber) || state.ownIds.has(changeId);
    state.live.add(changeId, sequenceNumber);
    this.deps.onSequence?.(sequenceNumber);
    if (known) return;
    try { this.applier?.(row); }
    catch (err) { console.warn('[sync] realtime apply failed:', err); }
  }
}

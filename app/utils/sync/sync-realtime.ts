import type { SyncDeps, SyncState } from '~/utils/sync/sync-context';

/**
 * Realtime (CDC) intake of the sync engine (ADR 0004 §3.2): the fast path
 * for `project_changes` inserts. Rows are deduplicated by change id against
 * the live sync position and this tab's own pushes, recorded (so pulls skip
 * them) and foreign ones applied: commands by the collaboration applier
 * (history), everything else through the state port.
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

/**
 * Applies a realtime insert to the live state (commands via history).
 * Returns `false` when it has no handler for the row (e.g. a live-op); the
 * intake then replays the row through the state port instead.
 */
export type RemoteApplier = (row: RemoteInsert) => boolean | void;

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
    try {
      // The row is recorded as seen, so a later pull skips it: it MUST be
      // applied here. Live-op rows (and every row without a collaboration
      // applier) go through the state port. A live-op may also arrive by
      // broadcast; its values are absolute, so applying it twice is harmless.
      // Rows of a peer that edited offline were never broadcast at all.
      const handled = this.applier ? this.applier(row) !== false : false;
      if (handled) return;
      const replayed = this.deps.port.replay({ type: row.commandType, payload: row.payload, userId: row.userId });
      if (!replayed) console.warn(`[sync] no handler for realtime change "${row.commandType}"`);
      else this.deps.onLiveChanged?.();
    }
    catch (err) { console.warn('[sync] realtime apply failed:', err); }
  }
}

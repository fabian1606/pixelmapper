import type { ProjectSnapshot } from '~/utils/engine/serialize';
import type { NewOutboxEntry, OutboxEntry, ProjectStore } from '~/utils/persistence/project-store';
import type { RemoteClient, RemoteError } from '~/utils/sync/remote-api';
import type { ProjectStatePort } from '~/utils/sync/project-state-port';
import type { SyncConflictItem } from '~/utils/sync/sync-conflicts';
import type { PendingRow } from '~/utils/sync/sync-rebase';
import type { SyncPosition } from '~/utils/sync/sync-position';

/**
 * Shared dependencies and mutable state of one `SyncEngine` (ADR 0004 §3.2).
 * Split out so the cycle, push and checkpoint steps live in small modules.
 */

// ── Dependencies ─────────────────────────────────────────────────────────────

/** Access to outbox rows that are queued or being written (outbox-writer). */
export interface OutboxAccess {
  /** Make all queued rows durable. */
  flush(): Promise<void>;
  /** Rows of this project that are queued or being written, in order. */
  unconfirmed(): NewOutboxEntry[];
}

export interface SyncDeps {
  projectId: string;
  client: RemoteClient;
  store: ProjectStore;
  port: ProjectStatePort;
  outbox: OutboxAccess;
  /** True while the in-memory persist queue holds unsent entries. */
  hasQueuedEntries(): boolean;
  /** Write the working snapshot now (the writer attaches the live position). */
  writeWorking(): Promise<void>;
  /** Called after remote changes changed or replaced the live state. */
  onLiveChanged?(): void;
  /** Called for every server sequence number that is now reflected. */
  onSequence?(seq: number): void;
  /** Restore the `before offline sync` snapshot and reload (D5). */
  restoreBeforeSync?(snapshotId: string): Promise<boolean>;
  /** Interval of the fallback pull while open (ms). */
  periodicMs?: number;
}

// ── State ────────────────────────────────────────────────────────────────────

/** Base snapshot (server state at its position, nothing pending). */
export interface BaseState {
  snapshot: ProjectSnapshot;
  position: SyncPosition;
}

export interface SyncState {
  base: BaseState | null;
  /** Server changes the live state reflects. */
  live: SyncPosition;
  /**
   * Pending changes were made while sync was not possible (offline, failed
   * push, previous session). The next cycle rebases instead of pushing as is.
   */
  backlog: boolean;
  /** Change ids this client sent (CDC echo detection). */
  ownIds: Set<string>;
  /** Sequence numbers of acknowledged own changes (persist-queue results). */
  ackedSeq: Map<string, number>;
  /** `before offline sync` snapshot still to save before the next push (D5). */
  safety: { snapshot: ProjectSnapshot; seq: number } | null;
  /** Id of the last saved `before offline sync` snapshot. */
  safetySnapshotId: string | null;
  /** Conflicts of the last rebase, reported after its push succeeded. */
  conflicts: { items: SyncConflictItem[]; state: ProjectSnapshot } | null;
  /** Error of the last remote call, null after a success. */
  lastError: RemoteError | null;
  lastSyncedAt: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Pending changes = stored outbox + rows not written yet. A queued row with a
 * `dedupKey` supersedes a stored row of the same key (the store will replace
 * it on append), exactly like `appendOutbox` does.
 */
export function mergePending(stored: OutboxEntry[], unconfirmed: NewOutboxEntry[]): PendingRow[] {
  const out: PendingRow[] = stored.map(toPendingRow);
  for (const row of unconfirmed) {
    if (out.some(r => r.id === row.id)) continue;
    if (row.dedupKey) {
      const idx = out.findIndex(r => r.dedupKey === row.dedupKey);
      if (idx >= 0) out.splice(idx, 1);
    }
    out.push(toPendingRow(row));
  }
  return out;
}

/** Outbox row → pending row. */
function toPendingRow(row: NewOutboxEntry): PendingRow {
  return { id: row.id, type: row.type, kind: row.kind, payload: row.payload, dedupKey: row.dedupKey };
}

/** JSON copy (no proxies, no aliasing) for storage. */
export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

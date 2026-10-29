import type { LocalProjectMeta, ProjectStore } from '~/utils/persistence/project-store';
import type { PersistHook } from '~/utils/persistence/persist-queue';
import { flushOutboxWrites, getUnconfirmedOutboxRows, lastAppendedOutboxOrder, onOutboxWritten } from '~/utils/persistence/outbox-writer';
import { isOnline } from '~/utils/sync/connectivity';
import type { RemoteClient } from '~/utils/sync/remote-api';
import type { ProjectStatePort } from '~/utils/sync/project-state-port';
import { setSyncStatus } from '~/utils/sync/project-sync-service';
import { getOpenSyncEngine, setOpenSyncEngine } from '~/utils/sync/open-sync-engine';
import type { OpenedProject } from '~/utils/sync/open-flow';
import type { OutboxAccess } from '~/utils/sync/sync-context';
import { SyncEngine } from '~/utils/sync/sync-engine';
import { restoreBeforeSync } from '~/utils/sync/sync-restore';
import { isRemoteRestorePending } from '~/utils/sync/remote-restore';
import { createWorkingSnapshotWriter, type WorkingSnapshotWriter } from '~/utils/sync/working-snapshot-writer';

/**
 * Per-open-project session (ADR 0004 §3): working snapshot writer, the
 * SyncEngine (cloud projects bound to the signed-in account only) and the
 * push hook for the persist queue.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface SessionInput {
  projectId: string;
  store: ProjectStore;
  client: RemoteClient;
  port: ProjectStatePort;
  /** Signed-in account, null when signed out. */
  userId: string | null;
  opened: OpenedProject;
  /** True while the persist queue holds unsent entries. */
  hasQueuedEntries(): boolean;
  /** Remote changes changed / replaced the live state (UI refresh). */
  onLiveChanged(): void;
  /** A rebase replaced the live state (clear undo/redo). */
  onRebased?(): void;
  /** A server sequence number is reflected (`lastSeenSequenceNumber`). */
  onSequence(seq: number): void;
  /** Stop the session without writing the working snapshot (restore). */
  discardSession(): Promise<void>;
  /** Reload the project after a restore. */
  reload(): Promise<void>;
}

export interface ProjectSession {
  origin: 'local' | 'cloud';
  /** Sync engine; null for local-only projects and unbound cloud copies. */
  engine: SyncEngine | null;
  writer: WorkingSnapshotWriter;
  /** Push hook for the persist queue. */
  pushHook: PersistHook;
  /** Server snapshots may be saved now (cloud, synced, online, nothing pending). */
  canSaveServerSnapshot(): Promise<boolean>;
  /** Stop syncing; writes the working snapshot unless `discard` (project switch). */
  close(discard?: boolean): Promise<void>;
}

// ── Binding ──────────────────────────────────────────────────────────────────

/**
 * Why a cloud copy is not synced (D15, D3), or null when it may sync:
 * never while signed out, never for another account, never after the
 * project vanished from the server.
 */
export function syncBlocker(meta: LocalProjectMeta | null, userId: string | null): string | null {
  if (!userId) return 'Sign in to sync this project.';
  if (meta?.ownerUserId && meta.ownerUserId !== userId) return 'This copy belongs to another account.';
  if (meta?.remoteDeletedAt) return 'This project was deleted on the server.';
  return null;
}

// ── Session ──────────────────────────────────────────────────────────────────

/** Start the session of a freshly opened project. */
export function startProjectSession(input: SessionInput): ProjectSession {
  const { projectId, store, opened } = input;
  const origin = opened.meta?.origin ?? 'cloud';
  const outbox: OutboxAccess = {
    flush: flushOutboxWrites,
    unconfirmed: () => getUnconfirmedOutboxRows(projectId),
  };
  let engine: SyncEngine | null = null;

  const writer = createWorkingSnapshotWriter({
    projectId,
    store,
    capture: () => input.port.capture(),
    position: () => (origin === 'cloud' ? engine?.livePosition() ?? opened.position : null),
    outboxOrder: () => Math.max(opened.outboxOrder, lastAppendedOutboxOrder(projectId)),
    outbox: origin === 'cloud' ? outbox : null,
  });

  const blocker = origin === 'cloud' ? syncBlocker(opened.meta, input.userId) : null;
  if (origin === 'cloud' && !blocker) {
    engine = new SyncEngine({
      projectId,
      userId: input.userId!,
      client: input.client,
      store,
      port: input.port,
      outbox,
      hasQueuedEntries: input.hasQueuedEntries,
      writeWorking: () => writer.flush(),
      onLiveChanged: input.onLiveChanged,
      onRebased: input.onRebased,
      onSequence: input.onSequence,
      restoreBeforeSync: snapshotId => restoreBeforeSync({
        client: input.client, store, projectId, snapshotId, closeSession: input.discardSession, reload: input.reload,
      }),
    }, { base: opened.base, live: opened.position.clone(), backlog: opened.backlog });
    setOpenSyncEngine(engine);
    engine.start();
  }
  else {
    setOpenSyncEngine(null);
    void reportUnsyncedStatus(store, projectId, origin, blocker);
  }

  // Keep the pending count in the header current while editing.
  const stopWritten = onOutboxWritten((pid) => {
    if (pid !== projectId) return;
    if (engine) void engine.refreshStatus();
    else void reportUnsyncedStatus(store, projectId, origin, blocker);
  });

  return {
    origin,
    engine,
    writer,
    // Without an engine nothing is sent: rows stay in the outbox (unbound
    // cloud copy) or are not written at all (local-only project).
    pushHook: entries => (engine ? engine.pushForQueue(entries.map(e => e.changeId)) : Promise.resolve(entries.map(() => undefined))),
    async canSaveServerSnapshot() {
      // A remote restore is pending: the live state predates it (remote-restore.ts).
      if (!engine || !isOnline.value || isRemoteRestorePending()) return false;
      return (await store.countPending(projectId)) === 0;
    },
    async close(discard = false) {
      // Stop syncing first and wait for a running cycle/push: it may still
      // apply to the live state, which must be this project's when it ends.
      stopWritten();
      if (getOpenSyncEngine() === engine) setOpenSyncEngine(null);
      await engine?.stop();
      if (!discard) await writer.flush();
      writer.dispose();
    },
  };
}

/** Header status for projects without a sync engine. */
async function reportUnsyncedStatus(store: ProjectStore, projectId: string, origin: 'local' | 'cloud', blocker: string | null): Promise<void> {
  if (origin === 'local') {
    setSyncStatus({ state: 'local-only', pending: 0, error: undefined, lastSyncedAt: null });
    return;
  }
  const pending = await store.countPending(projectId).catch(() => 0);
  setSyncStatus({ state: 'offline', pending, error: blocker ?? undefined, lastSyncedAt: null });
}

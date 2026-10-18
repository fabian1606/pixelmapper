import { saveSnapshot } from '~/utils/sync/remote-api';
import { packSnapshot } from '~/utils/sync/sync-position';
import { plain, type SyncDeps, type SyncState } from '~/utils/sync/sync-context';
import { pushRows } from '~/utils/sync/sync-transport';

/**
 * Push and checkpoint steps of the sync engine (ADR 0004 §3.2 steps 4.1, 4.5, 5).
 * Callers hold the engine lock.
 */

/** Label of the safety-net snapshot (D5). */
export const BEFORE_SYNC_LABEL = 'before offline sync';

// ── Safety snapshot ──────────────────────────────────────────────────────────

/**
 * Save the pending `before offline sync` server snapshot. Returns false when
 * it could not be saved; nothing may be pushed then (D5).
 */
export async function saveSafetySnapshot(deps: SyncDeps, state: SyncState): Promise<boolean> {
  const safety = state.safety;
  if (!safety) return true;
  const res = await saveSnapshot(deps.client, {
    projectId: deps.projectId,
    snapshot: safety.snapshot,
    sequenceNumber: safety.seq,
    label: BEFORE_SYNC_LABEL,
  });
  if (!res.ok) {
    state.lastError = res.error;
    console.warn('[sync] saving the "before offline sync" snapshot failed:', res.error.message);
    return false;
  }
  state.safety = null;
  state.safetySnapshotId = res.data.id;
  return true;
}

// ── Push ─────────────────────────────────────────────────────────────────────

/**
 * Push every stored outbox row in order and acknowledge the confirmed ones.
 * Returns true when the outbox was pushed completely.
 */
export async function pushOutbox(deps: SyncDeps, state: SyncState): Promise<boolean> {
  await deps.outbox.flush();
  const rows = await deps.store.getOutbox(deps.projectId);
  if (rows.length === 0) { state.lastError = null; return true; }
  if (!(await saveSafetySnapshot(deps, state))) return false;

  // Known before sending, so the realtime echo of a row is never re-applied.
  for (const r of rows) state.ownIds.add(r.id);
  const { acks, error } = await pushRows(deps.client, deps.projectId, rows);
  const acked: string[] = [];
  for (const a of acks) {
    if (a.sequenceNumber == null) continue;
    acked.push(a.changeId);
    state.ackedSeq.set(a.changeId, a.sequenceNumber);
    state.live.add(a.changeId, a.sequenceNumber);
    deps.onSequence?.(a.sequenceNumber);
  }
  if (acked.length > 0) await deps.store.ackOutbox(acked);
  state.lastError = error;
  if (error) console.warn('[sync] push failed:', error.message);
  return !error && acked.length === rows.length;
}

// ── Checkpoint ───────────────────────────────────────────────────────────────

/**
 * With nothing pending, the live state IS the server state at the live
 * position: store it as the new base (and working) snapshot. Skipped while
 * any change is queued, being written or stored in the outbox.
 */
export async function checkpointBase(deps: SyncDeps, state: SyncState): Promise<boolean> {
  if (deps.hasQueuedEntries() || deps.outbox.unconfirmed().length > 0) return false;
  if (await deps.store.countPending(deps.projectId) > 0) return false;
  // Re-check synchronously, then capture before the next await.
  if (deps.hasQueuedEntries() || deps.outbox.unconfirmed().length > 0) return false;
  const snapshot = plain(deps.port.capture());
  const position = state.live.clone();
  // A row written between the count and the capture invalidates the checkpoint
  // (it cannot have been acked meanwhile: the caller holds the engine lock).
  if (await deps.store.countPending(deps.projectId) > 0) return false;
  state.base = { snapshot, position };
  await deps.store.putBaseSnapshot(deps.projectId, packSnapshot(snapshot, position), position.cursor);
  await deps.writeWorking();
  return true;
}

/** Record a successful sync in the project meta (`lastSyncedAt`). */
export async function touchLastSynced(deps: SyncDeps, state: SyncState, now: number): Promise<void> {
  state.lastSyncedAt = now;
  try {
    const meta = await deps.store.getProject(deps.projectId);
    if (meta) await deps.store.putProject({ ...meta, lastSyncedAt: now, serverCursor: state.base?.position.cursor ?? meta.serverCursor });
  }
  catch (err) {
    console.warn('[sync] updating project meta failed:', err);
  }
}

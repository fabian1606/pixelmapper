import type { LocalProjectMeta, ProjectStore } from '~/utils/persistence/project-store';
import { loadProject as loadRemoteProject, type RemoteClient, type RemoteProjectHead } from '~/utils/sync/remote-api';
import { packSnapshot, SyncPosition, unpackSnapshot, type StoredSyncSnapshot } from '~/utils/sync/sync-position';
import { pullAll, pushRows } from '~/utils/sync/sync-transport';
import { isCurrentAccount } from '~/utils/auth/current-account';

/**
 * Headless sync of projects that are NOT open (ADR 0004 D13, D15/D16).
 *
 * Without the live engine there is no way to replay changes, so headless
 * code only moves whole server snapshots and pushes outbox rows that need no
 * rebase. Everything else happens when the project is opened.
 */

// ── Mirror ───────────────────────────────────────────────────────────────────

/** Cursor of the newest local copy (working, else base), -1 without one. */
async function localCursor(store: ProjectStore, meta: LocalProjectMeta | null, id: string): Promise<number> {
  const working = await store.getWorkingSnapshot(id) as StoredSyncSnapshot | null;
  const base = working ?? await store.getBaseSnapshot(id) as StoredSyncSnapshot | null;
  if (!base) return -1;
  return unpackSnapshot(base, meta?.serverCursor ?? 0).position.cursor;
}

/**
 * Store the latest server snapshot of `head` as base + working copy when it
 * is newer than the local copy. Projects with pending local changes are left
 * alone (their rebase needs the old base). The change tail after the server
 * snapshot is pulled when the project is opened.
 */
export async function mirrorHeadless(
  store: ProjectStore,
  client: RemoteClient,
  head: RemoteProjectHead,
  userId: string,
): Promise<boolean> {
  const meta = await store.getProject(head.id);
  if (meta?.origin === 'local') return true;
  // Bound to another account (D15): never mix accounts.
  if (meta && meta.ownerUserId && meta.ownerUserId !== userId) return true;
  const now = Date.now();
  const nextMeta = (cursor: number): LocalProjectMeta => ({
    id: head.id,
    name: head.name,
    description: head.description ?? undefined,
    origin: 'cloud',
    ownerUserId: userId,
    role: head.role,
    serverCursor: cursor,
    createdAt: meta?.createdAt ?? (Date.parse(head.createdAt) || now),
    updatedAt: now,
    lastSyncedAt: now,
  });

  if (await store.countPending(head.id) > 0) {
    // No meta but pending rows: migrated from the legacy WAL without an
    // account. They are bound when a signed-in user opens the project, never
    // by a background pass (which could push another user's rows).
    if (meta) await store.putProject({ ...meta, name: head.name, role: head.role });
    return true;
  }
  const cursor = await localCursor(store, meta, head.id);
  if (cursor >= 0 && (head.latestSequence <= cursor || head.latestSnapshotSequence <= cursor)) {
    // Up to date, or only the tail is newer (pulled on open).
    if (meta) await store.putProject({ ...meta, name: head.name, role: head.role });
    return true;
  }

  const res = await loadRemoteProject(client, head.id);
  if (!res.ok) {
    console.warn(`[sync] mirroring ${head.id} failed:`, res.error.message);
    return false;
  }
  // Signed out or switched while downloading: write nothing for `userId`
  // (sign-out may just have removed this account's copies).
  if (!isCurrentAccount(userId)) return true;
  const { snapshot, snapshotSequence } = res.data;
  if (!snapshot) {
    // Nothing to store without a replay engine; opening online downloads it.
    console.info(`[sync] ${head.id} has no server snapshot yet; mirrored on first open`);
    return false;
  }
  const position = SyncPosition.at(snapshotSequence);
  await store.putProject(nextMeta(snapshotSequence));
  await store.putBaseSnapshot(head.id, packSnapshot(snapshot, position), snapshotSequence);
  await store.putWorkingSnapshot(head.id, packSnapshot(snapshot, position, 0));
  return true;
}

// ── Headless push ────────────────────────────────────────────────────────────

/**
 * Push the outbox of a closed project when no foreign server change happened
 * since its base (no rebase needed). Acked changes are recorded in the
 * working snapshot's position so the next open does not apply them twice.
 * Returns the number of rows still pending.
 */
export async function pushHeadless(store: ProjectStore, client: RemoteClient, projectId: string): Promise<number> {
  const meta = await store.getProject(projectId);
  const outbox = await store.getOutbox(projectId);
  if (outbox.length === 0) return 0;
  const baseStored = await store.getBaseSnapshot(projectId) as StoredSyncSnapshot | null;
  const basePosition = baseStored ? unpackSnapshot(baseStored, meta?.serverCursor ?? 0).position : SyncPosition.at(meta?.serverCursor ?? 0);
  const pulled = await pullAll(client, projectId, basePosition.pullFrom());
  if (!pulled.ok) return outbox.length;
  const ownIds = new Set(outbox.map(r => r.id));
  const foreign = pulled.data.changes.filter(c => !ownIds.has(c.changeId) && !basePosition.reflects(c.changeId, c.sequenceNumber));
  if (foreign.length > 0) {
    console.info(`[sync] ${projectId}: remote changes since the base, rebase deferred to the next open`);
    return outbox.length;
  }
  const alreadyThere = pulled.data.changes.filter(c => ownIds.has(c.changeId));
  const remaining = outbox.filter(r => !alreadyThere.some(c => c.changeId === r.id));
  const { acks } = await pushRows(client, projectId, remaining);
  const acked = [
    ...alreadyThere.map(c => ({ id: c.changeId, seq: c.sequenceNumber })),
    ...acks.filter(a => a.sequenceNumber != null).map(a => ({ id: a.changeId, seq: a.sequenceNumber! })),
  ];
  await recordInWorking(store, projectId, meta?.serverCursor ?? 0, acked);
  await store.ackOutbox(acked.map(a => a.id));
  return store.countPending(projectId);
}

/** Add acknowledged own changes to the working snapshot's position. */
async function recordInWorking(store: ProjectStore, projectId: string, cursor: number, acked: Array<{ id: string; seq: number }>): Promise<void> {
  if (acked.length === 0) return;
  const working = await store.getWorkingSnapshot(projectId) as StoredSyncSnapshot | null;
  if (!working) return;
  const { snapshot, position, outboxOrder } = unpackSnapshot(working, cursor);
  for (const a of acked) position.add(a.id, a.seq);
  await store.putWorkingSnapshot(projectId, packSnapshot(snapshot, position, outboxOrder));
}

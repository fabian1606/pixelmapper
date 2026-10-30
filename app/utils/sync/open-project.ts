import type { ProjectSnapshot } from '~/utils/engine/serialize';
import type { LocalProjectMeta, OutboxEntry, ProjectStore } from '~/utils/persistence/project-store';
import { loadProject as loadRemoteProject, type RemoteChange, type RemoteClient, type RemoteError, type RemoteResult } from '~/utils/sync/remote-api';
import type { BaseState } from '~/utils/sync/sync-context';
import { SyncPosition, unpackSnapshot, type StoredSyncSnapshot } from '~/utils/sync/sync-position';
import { pullAll } from '~/utils/sync/sync-transport';

/**
 * Data sources of the local-first open (ADR 0004 D1, §3.1):
 * the local copy (working snapshot, else base snapshot, plus the outbox) and
 * the first-open download (server snapshot + complete change tail).
 */

// ── Local copy ───────────────────────────────────────────────────────────────

/** What is needed to open a project from the local store. */
export interface LocalOpenData {
  meta: LocalProjectMeta | null;
  /** Snapshot to apply (working, else base). */
  snapshot: ProjectSnapshot;
  /** Server changes the snapshot reflects. */
  position: SyncPosition;
  /** Outbox rows the snapshot does not reflect yet (replay after apply). */
  replay: OutboxEntry[];
  /** All pending outbox rows. */
  outbox: OutboxEntry[];
  /** Highest outbox order reflected once `replay` is applied. */
  outboxOrder: number;
  /** Base snapshot for rebasing (null for local-only projects / missing). */
  base: BaseState | null;
}

/** Highest `order` of the rows (0 when empty). */
export function maxOrder(rows: OutboxEntry[]): number {
  return rows.reduce((m, r) => Math.max(m, r.order), 0);
}

/** Read the local copy; null when neither a working nor a base snapshot exists. */
export async function readLocalProject(store: ProjectStore, projectId: string): Promise<LocalOpenData | null> {
  const [meta, working, baseStored, outbox] = await Promise.all([
    store.getProject(projectId),
    store.getWorkingSnapshot(projectId) as Promise<StoredSyncSnapshot | null>,
    store.getBaseSnapshot(projectId) as Promise<StoredSyncSnapshot | null>,
    store.getOutbox(projectId),
  ]);
  const cursor = meta?.serverCursor ?? 0;
  const base = baseStored ? unpackSnapshot(baseStored, cursor) : null;
  const source = working ? unpackSnapshot(working, cursor) : base;
  if (!source) return null;
  // A base snapshot reflects no pending row; a working one those up to its order.
  const reflected = working ? source.outboxOrder : 0;
  const replay = outbox.filter(r => r.order > reflected);
  return {
    meta,
    snapshot: source.snapshot,
    position: source.position.clone(),
    replay,
    outbox,
    outboxOrder: Math.max(reflected, maxOrder(outbox)),
    base: base ? { snapshot: base.snapshot, position: base.position } : null,
  };
}

// ── First-open download ──────────────────────────────────────────────────────

/** Server state needed to build the first local copy. */
export interface DownloadedProject {
  snapshot: ProjectSnapshot | null;
  snapshotSequence: number;
  /** Complete change tail after the snapshot (ascending). */
  tail: RemoteChange[];
  /** Cursor after the tail. */
  cursor: number;
}

/**
 * `load-project`, continued with `pull-changes` when the tail was cut by the
 * server row cap. The cursor comes from `snapshotSequence` when the tail is
 * empty (the old client read `snapshot.sequence_number`, which does not exist).
 */
export async function downloadProject(client: RemoteClient, projectId: string): Promise<RemoteResult<DownloadedProject>> {
  const res = await loadRemoteProject(client, projectId);
  if (!res.ok) return res;
  const { snapshot, snapshotSequence, tail, tailTruncated } = res.data;
  const all = [...tail];
  let cursor = tail.length > 0 ? tail[tail.length - 1]!.sequenceNumber : snapshotSequence;
  if (tailTruncated) {
    const more = await pullAll(client, projectId, cursor);
    if (!more.ok) return more;
    const ids = new Set(all.map(c => c.changeId));
    for (const c of more.data.changes) if (!c.changeId || !ids.has(c.changeId)) all.push(c);
    cursor = Math.max(cursor, more.data.nextAfterSequence);
  }
  return { ok: true, data: { snapshot, snapshotSequence, tail: all, cursor } };
}

/** Position of a freshly downloaded project: snapshot floor + tail ids. */
export function downloadedPosition(d: DownloadedProject): SyncPosition {
  const position = SyncPosition.at(d.snapshotSequence);
  for (const c of d.tail) position.add(c.changeId, c.sequenceNumber);
  position.advance(d.cursor);
  return position;
}

/** How the open flow reacts to a failed download. */
export type DownloadFailure = 'offline-unavailable' | 'auth' | 'unauthorized' | 'error';

/** Classify a download error for the open flow. */
export function classifyDownloadError(error: RemoteError): DownloadFailure {
  if (error.kind === 'network') return 'offline-unavailable';
  if (error.kind === 'auth') return 'auth';
  if (error.kind === 'forbidden') return 'unauthorized';
  return 'error';
}

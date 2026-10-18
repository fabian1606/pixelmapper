import type { LocalProjectMeta, ProjectStore } from '~/utils/persistence/project-store';
import type { ProjectSyncService } from '~/utils/sync/project-sync-service';
import { listProjectsForSync, type RemoteClient } from '~/utils/sync/remote-api';
import type { RemoteError, RemoteProjectHead } from '~/utils/sync/remote-api-types';

/**
 * Reconciling the local store with the account's remote project heads, and
 * background mirroring of cloud projects (ADR 0004 D13).
 */

// ── Reconcile ────────────────────────────────────────────────────────────────

export interface ReconcileOptions {
  /** When the head list was requested; younger local copies are never treated as deleted. */
  requestStartedAt: number;
  now?: number;
}

export interface ReconcileResult {
  /** Heads whose local copy is missing or behind (for mirroring). */
  stale: RemoteProjectHead[];
  /** Ids removed locally because the project is gone on the server. */
  removed: string[];
  /** Copies kept because they still had pending changes (newly marked). */
  markedDeleted: LocalProjectMeta[];
}

/**
 * Applies remote heads to the local copies bound to `userId`:
 * - name, description and role follow the server;
 * - a copy whose project vanished from the list (deleted or access revoked)
 *   is removed, or kept and marked `remoteDeletedAt` if it has pending
 *   changes (so the user can detach it);
 * - copies bound to other accounts and local-only projects are never touched.
 */
export async function reconcileRemoteHeads(
  store: ProjectStore,
  heads: RemoteProjectHead[],
  userId: string,
  opts: ReconcileOptions,
): Promise<ReconcileResult> {
  const now = opts.now ?? Date.now();
  const headById = new Map(heads.map(h => [h.id, h]));
  const locals = await store.listProjects();
  const localById = new Map(locals.map(m => [m.id, m]));
  const result: ReconcileResult = { stale: [], removed: [], markedDeleted: [] };

  for (const meta of locals) {
    if (meta.origin !== 'cloud' || meta.ownerUserId !== userId) continue;
    const head = headById.get(meta.id);
    if (head) {
      await refreshMeta(store, meta, head);
      continue;
    }
    if (meta.createdAt >= opts.requestStartedAt) continue;
    if ((await store.countPending(meta.id)) > 0) {
      if (meta.remoteDeletedAt) continue;
      const marked = { ...meta, remoteDeletedAt: now };
      await store.putProject(marked);
      result.markedDeleted.push(marked);
      continue;
    }
    await store.deleteProject(meta.id);
    result.removed.push(meta.id);
  }

  for (const head of heads) {
    const local = localById.get(head.id);
    if (!local) {
      result.stale.push(head);
      continue;
    }
    // Same id bound elsewhere (other account / local-only): never synced from here.
    if (local.origin !== 'cloud' || local.ownerUserId !== userId) continue;
    if (head.latestSequence > local.serverCursor) result.stale.push(head);
  }
  return result;
}

/** Writes server-side name/description/role into the copy if they differ. */
async function refreshMeta(store: ProjectStore, meta: LocalProjectMeta, head: RemoteProjectHead): Promise<void> {
  const description = head.description ?? undefined;
  const changed = meta.name !== head.name
    || (meta.description ?? undefined) !== description
    || meta.role !== head.role
    || !!meta.remoteDeletedAt;
  if (!changed) return;
  const next: LocalProjectMeta = { ...meta, name: head.name || meta.name, role: head.role, remoteDeletedAt: null };
  next.description = description;
  await store.putProject(next);
}

// ── Mirror pass ──────────────────────────────────────────────────────────────

export interface MirrorPassDeps {
  client: RemoteClient;
  store: ProjectStore;
  sync: ProjectSyncService;
  userId: string;
  /** Stops between projects (sign-out, account switch). */
  isCancelled?: () => boolean;
}

export type MirrorPassResult =
  | { ok: true; mirrored: number; failed: number; reconcile: ReconcileResult }
  | { ok: false; error: RemoteError };

/**
 * One background pass: fetch heads, reconcile, then mirror every stale
 * project sequentially (one request chain at a time). `ok` is true only if
 * the list was fetched; failed projects are counted.
 */
export async function runMirrorPass(deps: MirrorPassDeps): Promise<MirrorPassResult> {
  const requestStartedAt = Date.now();
  const res = await listProjectsForSync(deps.client);
  if (!res.ok) return { ok: false, error: res.error };
  if (deps.isCancelled?.()) return { ok: true, mirrored: 0, failed: 0, reconcile: { stale: [], removed: [], markedDeleted: [] } };

  const reconcile = await reconcileRemoteHeads(deps.store, res.data, deps.userId, { requestStartedAt });
  let mirrored = 0;
  let failed = 0;
  for (const head of reconcile.stale) {
    if (deps.isCancelled?.()) break;
    const ok = await deps.sync.mirrorProject(head, deps.userId);
    if (ok) mirrored++;
    else failed++;
  }
  return { ok: true, mirrored, failed, reconcile };
}

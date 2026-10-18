import type { LocalProjectMeta, ProjectStore } from '~/utils/persistence/project-store';

/**
 * Web cache hygiene for copies of another account (ADR 0004 D16).
 *
 * A deliberate web sign-out clears the cache. An automatic one (the auth
 * server rejected the refresh, or the 401 path in `loadProject`) cannot:
 * the session is already gone, so nothing can be synced first. Those
 * copies stay bound to their account and are cleaned up here when a
 * different account signs in, as long as that loses nothing: copies with
 * pending outbox rows are kept (they sync when their owner signs in again).
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ForeignCleanupResult {
  /** Removed copies (nothing pending; the server still has them). */
  removed: string[];
  /** Kept copies with unsynced changes of their account. */
  keptPending: LocalProjectMeta[];
}

/** Bound to an account that is not `userId`. */
function isForeign(meta: LocalProjectMeta, userId: string): boolean {
  return meta.origin === 'cloud' && !!meta.ownerUserId && meta.ownerUserId !== userId;
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Remove the cloud copies bound to other accounts than `userId` that have
 * nothing pending. Local-only and unbound copies are never touched.
 */
export async function clearForeignCopies(store: ProjectStore, userId: string): Promise<ForeignCleanupResult> {
  const result: ForeignCleanupResult = { removed: [], keptPending: [] };
  for (const meta of await store.listProjects()) {
    if (!isForeign(meta, userId)) continue;
    if ((await store.countPending(meta.id)) > 0) {
      result.keptPending.push(meta);
      continue;
    }
    await store.deleteProject(meta.id);
    result.removed.push(meta.id);
  }
  return result;
}

/**
 * Before opening `meta` on the web: a copy bound to another account with
 * nothing pending is dropped, so the project opens from the server for the
 * signed-in account instead of as a stale, unsyncable foreign copy.
 * Returns true when the copy was removed.
 */
export async function dropForeignCopyForOpen(
  store: ProjectStore,
  meta: LocalProjectMeta | null,
  userId: string | null,
): Promise<boolean> {
  if (!meta || !userId || !isForeign(meta, userId)) return false;
  if ((await store.countPending(meta.id)) > 0) return false;
  await store.deleteProject(meta.id);
  return true;
}

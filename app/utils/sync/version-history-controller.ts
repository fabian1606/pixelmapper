import { computed, ref, shallowRef } from 'vue';
import type { Ref } from 'vue';
import type { RemoteClient } from '~/utils/sync/remote-api-invoke';
import { listSnapshots, type SnapshotListEntry } from '~/utils/sync/remote-api-snapshots';

/**
 * State + actions of the version history of one project (ADR 0004 D17).
 *
 * Framework-free apart from Vue refs: every side effect comes in through
 * `VersionHistoryDeps`, so the logic is unit-tested without Nuxt
 * (`useVersionHistory` wires the real dependencies).
 *
 * - Lists server snapshots page by page (`list-snapshots`, newest first).
 * - Keeps the last loaded list per project in memory; offline it is shown
 *   as `stale` with restore disabled.
 * - Restores through the open sync engine (restore RPC + reload), after
 *   flushing pending outbox changes; refuses when they cannot be flushed.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** The part of `SyncEngine` the restore needs. */
export interface RestoreEngine {
  flushNow(): Promise<void>;
  restoreSnapshot(snapshotId: string): Promise<boolean>;
}

export type ProjectRole = 'owner' | 'editor' | 'viewer';

export interface VersionHistoryDeps {
  projectId: string;
  /** Local-only project (no server, no history). */
  isLocal: () => boolean;
  /** Supabase client; null when unavailable. */
  client: () => RemoteClient | null;
  online: Readonly<Ref<boolean>>;
  /** Sync engine of the open project, if any. */
  engine: () => RestoreEngine | null;
  /** Pending (unsynced) changes of the open project, read after a flush. */
  pendingCount: () => number | Promise<number>;
  /** Role of the signed-in user in the project, if known. */
  role: () => Promise<ProjectRole | undefined>;
  /** Page size (default `VERSION_PAGE_SIZE`). */
  pageSize?: number;
}

/**
 * Restore outcome: `pending` = unsynced changes could not be flushed (restore
 * not attempted); `unavailable` = offline, viewer, no engine or busy.
 */
export type RestoreOutcome = 'restored' | 'failed' | 'pending' | 'unavailable';

/** Entries per request. */
export const VERSION_PAGE_SIZE = 30;

// ── Cache ────────────────────────────────────────────────────────────────────

interface CachedList { entries: SnapshotListEntry[]; nextCursor: string | null }

/** Last loaded list per project (in memory, survives closing the popover). */
const cache = new Map<string, CachedList>();

/** Test helper / sign-out: drop all cached lists. */
export function clearVersionHistoryCache(): void {
  cache.clear();
}

// ── Controller ───────────────────────────────────────────────────────────────

export function createVersionHistory(deps: VersionHistoryDeps) {
  const cached = cache.get(deps.projectId);
  const entries = shallowRef<SnapshotListEntry[]>(cached?.entries ?? []);
  const nextCursor = ref<string | null>(cached?.nextCursor ?? null);
  const loaded = ref(!!cached);
  const loading = ref(false);
  const loadingMore = ref(false);
  const error = ref<string | null>(null);
  /** Showing the cached list because the server could not be asked. */
  const stale = ref(!!cached);
  const role = ref<ProjectRole | undefined>(undefined);
  const restoringId = ref<string | null>(null);
  /** Bumped by `refresh`; older responses are dropped. */
  let generation = 0;

  const canRestore = computed(() =>
    !deps.isLocal() && deps.online.value && role.value !== 'viewer' && !stale.value && restoringId.value === null);

  /** Store the list in state and cache. */
  function commit(list: SnapshotListEntry[], cursor: string | null): void {
    entries.value = list;
    nextCursor.value = cursor;
    loaded.value = true;
    cache.set(deps.projectId, { entries: list, nextCursor: cursor });
  }

  /** Load (or reload) the newest page. Offline: keep the cached list. */
  async function refresh(): Promise<void> {
    if (deps.isLocal()) return;
    void deps.role().then((r) => { role.value = r; }).catch(() => {});
    const client = deps.client();
    if (!deps.online.value || !client) {
      stale.value = loaded.value;
      return;
    }
    const gen = ++generation;
    loading.value = true;
    error.value = null;
    try {
      const res = await listSnapshots(client, { projectId: deps.projectId, limit: deps.pageSize ?? VERSION_PAGE_SIZE });
      if (gen !== generation) return;
      if (res.ok) {
        commit(res.data.snapshots, res.data.nextCursor);
        stale.value = false;
      }
      else {
        error.value = res.error.kind === 'network' ? null : 'Could not load version history.';
        stale.value = loaded.value;
        if (res.error.kind !== 'network') console.warn('[version-history] list failed:', res.error.message);
      }
    }
    finally {
      if (gen === generation) loading.value = false;
    }
  }

  /** Append the next (older) page. */
  async function loadMore(): Promise<void> {
    const client = deps.client();
    const cursor = nextCursor.value;
    if (!cursor || !client || !deps.online.value || loadingMore.value || loading.value) return;
    const gen = generation;
    loadingMore.value = true;
    try {
      const res = await listSnapshots(client, { projectId: deps.projectId, before: cursor, limit: deps.pageSize ?? VERSION_PAGE_SIZE });
      if (gen !== generation) return;
      if (res.ok) {
        // Drop duplicates (a restore may have inserted rows meanwhile).
        const seen = new Set(entries.value.map(e => e.id));
        commit([...entries.value, ...res.data.snapshots.filter(e => !seen.has(e.id))], res.data.nextCursor);
      }
      else {
        error.value = 'Could not load more versions.';
      }
    }
    finally {
      loadingMore.value = false;
    }
  }

  /**
   * Restore `entry`: flush pending changes first (refuse when that fails),
   * then restore through the sync engine, which reloads the project.
   */
  async function restore(entry: SnapshotListEntry): Promise<RestoreOutcome> {
    if (!canRestore.value) return 'unavailable';
    const engine = deps.engine();
    if (!engine) return 'unavailable';
    restoringId.value = entry.id;
    try {
      if ((await deps.pendingCount()) > 0) {
        await engine.flushNow();
        if ((await deps.pendingCount()) > 0) return 'pending';
      }
      const ok = await engine.restoreSnapshot(entry.id);
      if (!ok) return 'failed';
      // The restore added a snapshot: the list is outdated.
      cache.delete(deps.projectId);
      return 'restored';
    }
    catch (err) {
      console.warn('[version-history] restore failed:', err);
      return 'failed';
    }
    finally {
      restoringId.value = null;
    }
  }

  return {
    entries, nextCursor, loaded, loading, loadingMore, error, stale, role, restoringId, canRestore,
    refresh, loadMore, restore,
  };
}

export type VersionHistory = ReturnType<typeof createVersionHistory>;

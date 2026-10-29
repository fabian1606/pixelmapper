/**
 * Reactive, locally persisted collection of user records of one kind
 * (ADR 0004 D21). Writes go to IndexedDB first and are synced to Supabase
 * in the background: debounced after local changes, on login (session) and
 * on reconnect; failures retry with `backoffDelay` (D9).
 *
 * Without a signed-in account records stay local (`ownerUserId: null`).
 */
import { readonly, ref, shallowRef } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import {
  isNetworkError,
  onReconnect,
  reportNetworkFailure,
  reportNetworkSuccess,
} from '../connectivity';
import { hasIndexedDb, listRecords, mutateRecord, putRecords } from './record-db';
import { RecordSyncAbortedError, syncRecordKind } from './record-sync';
import { createSyncScheduler } from './sync-scheduler';
import {
  getRecordRemote,
  getRecordUser,
  getRegisteredCollection,
  noteOwnerlessWrites,
  registerCollection,
} from './record-session';
import type { RegisteredCollection } from './record-session';
import type { RecordItem, UserRecord } from './types';

// ── Types ────────────────────────────────────────────────────────────────────

/** Sync state of a collection. */
export type RecordSyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

/** Options of `createRecordCollection`. */
export interface RecordCollectionOptions {
  /** Delay between a local change and the sync it triggers (default 1 s). */
  debounceMs?: number;
}

/** A reactive record collection. */
export interface RecordCollection<T> extends RegisteredCollection {
  /** Visible records (no tombstones, own or local-only), newest first. */
  readonly items: Readonly<ShallowRef<readonly RecordItem<T>[]>>;
  /** Sync state. */
  readonly status: Readonly<Ref<RecordSyncStatus>>;
  /** Resolves after the first local load. */
  readonly ready: Promise<void>;
  /** Visible record by id. */
  get(id: string): RecordItem<T> | undefined;
  /** Creates (new UUID) or replaces (`id` given) a record. Returns its id. */
  put(data: T, id?: string): Promise<string>;
  /** Creates several records in one transaction (imports). Returns their ids. */
  putMany(entries: ReadonlyArray<{ data: T; id?: string }>): Promise<string[]>;
  /** Deletes a record (tombstone if it belongs to an account). */
  remove(id: string): Promise<void>;
}

const DEFAULT_DEBOUNCE_MS = 1_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Whether a record is shown for the current account. */
function isVisible(record: UserRecord, userId: string | null): boolean {
  if (record.deletedAt !== null) return false;
  // Signed out: everything on this device stays usable (cf. D15).
  if (userId === null) return true;
  return record.ownerUserId === null || record.ownerUserId === userId;
}

/** Local write clock: monotonic per record even if a remote clock ran ahead. */
function nextUpdatedAt(current: UserRecord | undefined): number {
  return Math.max(Date.now(), (current?.updatedAt ?? 0) + 1);
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Returns the collection of `kind`, creating it on first use (one instance
 * per kind and process, so every consumer sees the same list).
 */
export function createRecordCollection<T>(kind: string, options: RecordCollectionOptions = {}): RecordCollection<T> {
  const existing = getRegisteredCollection(kind);
  if (existing) return existing as RecordCollection<T>;

  const items = shallowRef<readonly RecordItem<T>[]>([]);
  const status = ref<RecordSyncStatus>('idle');

  // ── Local list ──
  async function reload(): Promise<void> {
    if (!hasIndexedDb()) return;
    const userId = getRecordUser();
    const records = await listRecords(kind);
    items.value = records
      .filter(r => isVisible(r, userId))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(r => ({ id: r.id, data: r.data as T, updatedAt: r.updatedAt, ownerUserId: r.ownerUserId }));
  }

  // ── Sync ──
  /** One round for the signed-in account; `false` asks for a backoff retry. */
  async function runOnce(): Promise<boolean> {
    const remote = getRecordRemote();
    const userId = getRecordUser();
    if (!remote || !userId || !hasIndexedDb()) return true;
    status.value = 'syncing';
    let ok = true;
    try {
      // The account may switch mid-round: stop writing as soon as it does.
      await syncRecordKind({ remote, kind, userId, isCurrent: () => getRecordUser() === userId });
      status.value = 'idle';
      reportNetworkSuccess();
    }
    catch (err) {
      ok = false;
      if (err instanceof RecordSyncAbortedError) {
        // Not a failure: the next account's round (from setRecordUser) takes over.
        ok = true;
        status.value = 'idle';
      }
      else if (isNetworkError(err)) {
        reportNetworkFailure();
        status.value = 'offline';
      }
      else {
        console.warn(`[records:${kind}] sync failed:`, err);
        status.value = 'error';
      }
    }
    await reload();
    return ok;
  }

  const scheduler = createSyncScheduler({ run: runOnce, debounceMs: options.debounceMs ?? DEFAULT_DEBOUNCE_MS });
  const { syncNow, scheduleDebounced, whenIdle } = scheduler;

  // ── Mutations ──
  async function put(data: T, id?: string): Promise<string> {
    const [savedId] = await putMany([{ data, id }]);
    return savedId!;
  }

  async function putMany(entries: ReadonlyArray<{ data: T; id?: string }>): Promise<string[]> {
    const ids = entries.map(e => e.id ?? crypto.randomUUID());
    let owner: string | null;
    if (ids.length === 1) {
      // Single write: atomic read-modify-write keeps the owner and clock.
      const written = await mutateRecord(ids[0]!, current => ({
        id: ids[0]!,
        kind,
        data: entries[0]!.data,
        updatedAt: nextUpdatedAt(current),
        deletedAt: null,
        dirty: true,
        ownerUserId: current ? current.ownerUserId : getRecordUser(),
      }));
      owner = written ? written.ownerUserId : null;
    }
    else {
      const now = Date.now();
      owner = getRecordUser();
      await putRecords(entries.map((e, i) => ({
        id: ids[i]!, kind, data: e.data, updatedAt: now, deletedAt: null, dirty: true, ownerUserId: owner,
      })));
    }
    // Written before the account was known: adopted once it is (setRecordUser).
    if (owner === null) noteOwnerlessWrites(ids);
    await reload();
    scheduleDebounced();
    return ids;
  }

  async function remove(id: string): Promise<void> {
    await mutateRecord(id, (current) => {
      if (!current) return undefined;
      // Never synced: nothing to tell the server.
      if (current.ownerUserId === null) return null;
      const at = nextUpdatedAt(current);
      return { ...current, deletedAt: at, updatedAt: at, dirty: true };
    });
    await reload();
    scheduleDebounced();
  }

  // ── Lifecycle ──
  const offReconnect = onReconnect(() => { scheduler.resetBackoff(); void syncNow(); });

  function dispose(): void {
    scheduler.dispose();
    offReconnect();
  }

  const collection: RecordCollection<T> = {
    kind,
    // Not wrapped in readonly(): that would proxy every payload deeply.
    items: items as Readonly<ShallowRef<readonly RecordItem<T>[]>>,
    status: readonly(status),
    ready: reload()
      // A collection created while signed in syncs once right away.
      .then(() => { if (getRecordUser()) void syncNow(); })
      .catch(err => console.error(`[records:${kind}] load failed:`, err)),
    get: id => items.value.find(item => item.id === id),
    put,
    putMany,
    remove,
    reload,
    syncNow,
    whenIdle,
    dispose,
  };
  registerCollection(collection);
  return collection;
}

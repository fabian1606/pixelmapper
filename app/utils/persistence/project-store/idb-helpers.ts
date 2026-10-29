/**
 * Low-level IndexedDB helpers for the project store: schema constants, a
 * cached-but-recoverable connection opener and promise wrappers for
 * requests / transactions.
 *
 * Kept separate from `indexeddb-project-store.ts` so the store file only
 * contains the `ProjectStore` semantics.
 */

// ── Schema ───────────────────────────────────────────────────────────────────

/** Default database name of the local project store. */
export const PROJECT_DB_NAME = 'pixelmapper-projects';
/** Current schema version. Bump together with a step in `upgradeSchema`. */
export const PROJECT_DB_VERSION = 1;

/** `LocalProjectMeta` records, keyPath `id`. */
export const META_STORE = 'meta';
/** `{ projectId, snapshot }` records, keyPath `projectId`. */
export const BASE_STORE = 'base-snapshots';
/** `{ projectId, snapshot }` records, keyPath `projectId`. */
export const WORKING_STORE = 'working-snapshots';
/** `OutboxEntry` records, keyPath `id`. */
export const OUTBOX_STORE = 'outbox';
/** `{ name, value }` records, keyPath `name` (persisted counters). */
export const COUNTER_STORE = 'counters';

/** Outbox index on `[projectId, order]` (per-project ordered reads). */
export const OUTBOX_BY_PROJECT_ORDER = 'byProjectOrder';
/** Outbox index on `[projectId, dedupKey]` (entries without dedupKey are not indexed). */
export const OUTBOX_BY_PROJECT_DEDUP = 'byProjectDedup';
/** Outbox index on `order` (global max lookup). */
export const OUTBOX_BY_ORDER = 'byOrder';

/** Counter record name of the monotonic outbox order. */
export const OUTBOX_ORDER_COUNTER = 'outboxOrder';

/** All object stores, e.g. for `clearAll` transactions. */
export const ALL_STORES = [META_STORE, BASE_STORE, WORKING_STORE, OUTBOX_STORE, COUNTER_STORE];

/** Creates / migrates object stores. Runs inside the versionchange transaction. */
function upgradeSchema(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    db.createObjectStore(META_STORE, { keyPath: 'id' });
    db.createObjectStore(BASE_STORE, { keyPath: 'projectId' });
    db.createObjectStore(WORKING_STORE, { keyPath: 'projectId' });
    db.createObjectStore(COUNTER_STORE, { keyPath: 'name' });
    const outbox = db.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
    outbox.createIndex(OUTBOX_BY_PROJECT_ORDER, ['projectId', 'order']);
    outbox.createIndex(OUTBOX_BY_PROJECT_DEDUP, ['projectId', 'dedupKey']);
    outbox.createIndex(OUTBOX_BY_ORDER, 'order');
  }
}

// ── Connection ───────────────────────────────────────────────────────────────

/**
 * Lazily opens a database and caches the connection. Failures are NOT cached
 * (Safari private mode, quota, blocked upgrades) so the next call retries;
 * a closed / version-changed connection clears the cache as well.
 */
export function createDbOpener(
  dbName: string,
  getFactory: () => IDBFactory | undefined,
): { open: () => Promise<IDBDatabase>; close: () => void } {
  let dbPromise: Promise<IDBDatabase> | null = null;

  /** Opens (or returns the cached) connection. */
  function open(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    const promise = new Promise<IDBDatabase>((resolve, reject) => {
      const factory = getFactory();
      if (!factory) {
        reject(new Error('IndexedDB not available'));
        return;
      }
      let req: IDBOpenDBRequest;
      try {
        req = factory.open(dbName, PROJECT_DB_VERSION);
      }
      catch (err) {
        // Some browsers throw synchronously (e.g. SecurityError in sandboxed frames).
        reject(err);
        return;
      }
      req.onupgradeneeded = (event) => {
        upgradeSchema(req.result, event.oldVersion);
      };
      req.onsuccess = () => {
        const db = req.result;
        // Another tab wants a newer version: release the connection and let
        // the next call reopen instead of failing with "connection is closing".
        db.onversionchange = () => {
          db.close();
          if (dbPromise === promise) dbPromise = null;
        };
        db.onclose = () => {
          if (dbPromise === promise) dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
    dbPromise = promise;
    // Don't cache failures — allow a retry on the next call.
    promise.catch(() => {
      if (dbPromise === promise) dbPromise = null;
    });
    return promise;
  }

  /** Closes the cached connection (tests, logout). */
  function close(): void {
    const current = dbPromise;
    dbPromise = null;
    current?.then(db => db.close()).catch(() => {});
  }

  return { open, close };
}

// ── Promise wrappers ─────────────────────────────────────────────────────────

/** Resolves with the request result. */
export function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Runs `fn` inside one transaction over `stores` and resolves with its
 * result only after the transaction committed (durability guarantee).
 * Any request error or exception aborts the whole transaction (atomicity).
 */
export async function runTransaction<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const tx = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
  let result: T;
  try {
    result = await fn(tx);
  }
  catch (err) {
    try {
      tx.abort();
    }
    catch {
      // Transaction already finished or aborted.
    }
    await done.catch(() => {});
    throw err;
  }
  await done;
  return result;
}

/**
 * Write-Ahead Log for project changes, backed by IndexedDB.
 *
 * Every SerializableCommand gets written here BEFORE it is sent to the
 * `push-change` edge function. The entry stays until the server acknowledges
 * it (and returns the assigned sequence_number); only then is it removed.
 *
 * On project load, any leftover pending entries are pushed to the server before
 * the rest of the loadProject flow runs — that way state that did not make it
 * to the server in a previous session (page crash, dropped keepalive, browser
 * close mid-flush) is recovered exactly once.
 *
 * The server side uses `(project_id, change_id)` as an idempotency key, so
 * re-pushing the same entry after a successful-but-unacknowledged previous
 * push is safe.
 */

const DB_NAME = 'pixelmapper-wal';
const STORE = 'pending-changes';
const VERSION = 1;

export interface WalEntry {
  /** Client-generated UUID; equals project_changes.change_id on the server. */
  id: string;
  projectId: string;
  commandType: string;
  payload: unknown;
  /** Date.now() when the entry was queued — used to preserve push order. */
  enqueuedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('byProject', 'projectId');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // If another tab opens a newer version, this connection gets closed —
      // clear the cache so the next call re-opens. Without this, subsequent
      // transactions would silently fail with "database connection is closing".
      db.onversionchange = () => { db.close(); dbPromise = null; };
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => {
      // Don't cache the rejection — allow retry on next call (e.g. once Safari
      // private mode opens up, or once disk space frees).
      dbPromise = null;
      reject(req.error);
    };
    req.onblocked = () => {
      dbPromise = null;
      reject(new Error('IndexedDB open blocked'));
    };
  });
  return dbPromise;
}

/**
 * Append a pending change. Resolves once the IndexedDB write transaction
 * is committed — callers MUST NOT rely on the entry being durable before
 * this promise resolves.
 */
export async function walAppend(entry: WalEntry): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => {
      console.debug(`[WAL] wrote ${entry.commandType} (${entry.id.slice(0, 8)})`);
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Remove acknowledged entries. No-op for unknown ids. */
export async function walMarkAcked(ids: string[]): Promise<void> {
  const validIds = ids.filter(id => typeof id === 'string' && id.length > 0);
  if (validIds.length === 0) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const id of validIds) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Pending entries for the given project, ordered by enqueuedAt ascending. */
export async function walGetPending(projectId: string): Promise<WalEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const idx = tx.objectStore(STORE).index('byProject');
    const req = idx.getAll(projectId);
    req.onsuccess = () => {
      const rows = (req.result as WalEntry[]).sort((a, b) => a.enqueuedAt - b.enqueuedAt);
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

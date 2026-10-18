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
 *
 * Since ADR 0004 D8 persistent live-ops are written here too (`kind:
 * 'live-op'`). They carry a `dedupKey`: appending an entry with a dedupKey
 * removes every older entry of the same project with the same key in the same
 * transaction, so only the latest payload of a coalesced op is ever pushed.
 * Both fields are optional, so rows written by older builds stay valid (they
 * are treated as commands) and the DB schema/version is unchanged.
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
  /**
   * Strictly increasing timestamp from `walNextEnqueuedAt()` taken when the
   * change was made — used to preserve push order (also across kinds).
   */
  enqueuedAt: number;
  /** Origin of the entry. Missing on rows from older builds → 'command'. */
  kind?: 'command' | 'live-op';
  /** Coalescing key: a newer entry with the same key replaces older ones. */
  dedupKey?: string;
}

// ── Ordering ─────────────────────────────────────────────────────────────────

let lastEnqueuedAt = 0;

/**
 * Wall-clock based, strictly increasing timestamp for `WalEntry.enqueuedAt`.
 * Two changes made within the same millisecond still get distinct values,
 * so recovery replays them in exactly the order they were made.
 */
export function walNextEnqueuedAt(): number {
  lastEnqueuedAt = Math.max(Date.now(), lastEnqueuedAt + 1);
  return lastEnqueuedAt;
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
  await walAppendBatch([entry]);
  console.debug(`[WAL] wrote ${entry.commandType} (${entry.id.slice(0, 8)})`);
}

/**
 * Append several entries in ONE transaction (in array order). For every entry
 * with a `dedupKey`, older rows of the same project with the same key are
 * deleted first, so a superseded live-op is never pushed. Resolves once the
 * transaction committed.
 */
export async function walAppendBatch(entries: WalEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);

    // Without any dedupKey a plain put per entry is enough.
    if (!entries.some(e => e.dedupKey)) {
      for (const e of entries) store.put(e);
      return;
    }

    // Load the existing rows of every affected project, then delete the
    // superseded ones and write the new entries — all inside this transaction.
    const projectIds = [...new Set(entries.filter(e => e.dedupKey).map(e => e.projectId))];
    const existing: WalEntry[] = [];
    let remaining = projectIds.length;
    for (const projectId of projectIds) {
      const req = store.index('byProject').getAll(projectId);
      req.onsuccess = () => {
        existing.push(...(req.result as WalEntry[]));
        if (--remaining === 0) writeDeduped(store, existing, entries);
      };
    }
  });
}

/** Delete rows superseded by `entries` (same project + dedupKey), then put `entries`. */
function writeDeduped(store: IDBObjectStore, existing: WalEntry[], entries: WalEntry[]): void {
  const newIds = new Set(entries.map(e => e.id));
  // Latest new entry per (project, dedupKey) — earlier ones in the batch are superseded too.
  const latestByKey = new Map<string, WalEntry>();
  for (const e of entries) {
    if (e.dedupKey) latestByKey.set(`${e.projectId}\u0000${e.dedupKey}`, e);
  }
  for (const row of existing) {
    if (!row.dedupKey || newIds.has(row.id)) continue;
    if (latestByKey.has(`${row.projectId}\u0000${row.dedupKey}`)) store.delete(row.id);
  }
  for (const e of entries) {
    const latest = e.dedupKey ? latestByKey.get(`${e.projectId}\u0000${e.dedupKey}`) : undefined;
    if (latest && latest !== e) continue; // superseded inside the same batch
    store.put(e);
  }
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

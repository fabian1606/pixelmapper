/**
 * IndexedDB access for user records (`pixelmapper-user-records`).
 *
 * One `records` object store keyed by id with a `kind` index, plus a `meta`
 * store for pull cursors. All IndexedDB calls of the record sync live here
 * so the rest of the module stays storage-agnostic.
 */
import type { UserRecord } from './types';

// ── Constants ────────────────────────────────────────────────────────────────

export const RECORD_DB_NAME = 'pixelmapper-user-records';
const RECORD_DB_VERSION = 1;
const RECORDS_STORE = 'records';
const META_STORE = 'meta';

/** Result of a `mutateRecord` callback: a new record, `null` = delete, `undefined` = keep. */
export type RecordMutation = UserRecord | null | undefined;

// ── Connection ───────────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

/** True when IndexedDB exists in this runtime (false during SSR). */
export function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

/** Opens (once) and returns the record database. */
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(RECORD_DB_NAME, RECORD_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECORDS_STORE)) {
        const store = db.createObjectStore(RECORDS_STORE, { keyPath: 'id' });
        store.createIndex('kind', 'kind', { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrades or deletes the DB: let it, reopen lazily.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => { dbPromise = null; reject(request.error); };
  });
  return dbPromise;
}

/** Closes the connection (tests, logout). The next call reopens it. */
export async function closeRecordDb(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  if (!pending) return;
  try { (await pending).close(); }
  catch { /* opening failed — nothing to close */ }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Promisifies a single request. */
function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Resolves when a transaction commits. */
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

// ── Records ──────────────────────────────────────────────────────────────────

/** All records of a kind (or all records), including tombstones. */
export async function listRecords(kind?: string): Promise<UserRecord[]> {
  const db = await openDb();
  const store = db.transaction(RECORDS_STORE, 'readonly').objectStore(RECORDS_STORE);
  const request = kind === undefined ? store.getAll() : store.index('kind').getAll(kind);
  return (await req(request)) as UserRecord[];
}

/** One record by id. */
export async function getRecord(id: string): Promise<UserRecord | undefined> {
  const db = await openDb();
  const store = db.transaction(RECORDS_STORE, 'readonly').objectStore(RECORDS_STORE);
  return (await req(store.get(id))) as UserRecord | undefined;
}

/** Writes several records in one transaction. */
export async function putRecords(records: UserRecord[]): Promise<void> {
  if (records.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(RECORDS_STORE, 'readwrite');
  const store = tx.objectStore(RECORDS_STORE);
  for (const record of records) store.put(record);
  await done(tx);
}

/**
 * Atomic read-modify-write of one record: `fn` receives the current record
 * and returns the replacement (`null` deletes, `undefined` keeps it).
 */
export async function mutateRecord(
  id: string,
  fn: (current: UserRecord | undefined) => RecordMutation,
): Promise<RecordMutation> {
  const db = await openDb();
  const tx = db.transaction(RECORDS_STORE, 'readwrite');
  const store = tx.objectStore(RECORDS_STORE);
  let result: RecordMutation;
  const getRequest = store.get(id);
  getRequest.onsuccess = () => {
    result = fn(getRequest.result as UserRecord | undefined);
    if (result === null) store.delete(id);
    else if (result !== undefined) store.put(result);
  };
  await done(tx);
  return result;
}

/** Deletes every record and every cursor. */
export async function clearRecordDb(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([RECORDS_STORE, META_STORE], 'readwrite');
  tx.objectStore(RECORDS_STORE).clear();
  tx.objectStore(META_STORE).clear();
  await done(tx);
}

// ── Meta ─────────────────────────────────────────────────────────────────────

/** Reads a meta value (e.g. a pull cursor). */
export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  const store = db.transaction(META_STORE, 'readonly').objectStore(META_STORE);
  return (await req(store.get(key))) as T | undefined;
}

/** Writes a meta value. */
export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(META_STORE, 'readwrite');
  tx.objectStore(META_STORE).put(value, key);
  await done(tx);
}

/**
 * Client cache of content-plugin packages (ADR §6.10): IndexedDB store
 * `pm-content-plugins`, keyed by hash. Packages are immutable, so entries
 * never need invalidation.
 *
 * `PluginCache` is an interface so tests and SSR can use `createMemoryCache`.
 */
import type { ContentPluginPackage } from '@pixelmapper/plugin-toolchain/types';

/** Package cache. */
export interface PluginCache {
  get(hash: string): Promise<ContentPluginPackage | null>;
  put(pkg: ContentPluginPackage): Promise<void>;
  /** All cached packages (for listings). */
  all(): Promise<ContentPluginPackage[]>;
}

const DB_NAME = 'pm-content-plugins';
const STORE = 'packages';
const VERSION = 1;

/** In-memory cache (tests, SSR, IndexedDB unavailable). */
export function createMemoryCache(): PluginCache {
  const map = new Map<string, ContentPluginPackage>();
  return {
    get: async hash => map.get(hash) ?? null,
    put: async (pkg) => { map.set(pkg.hash, pkg); },
    all: async () => [...map.values()],
  };
}

/** IndexedDB-backed cache; falls back to memory when IndexedDB fails to open. */
export function createIdbCache(): PluginCache {
  const fallback = createMemoryCache();
  let dbPromise: Promise<IDBDatabase> | null = null;

  /** Opens (once) the database; rejects when IndexedDB is unavailable. */
  function open(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB not available'));
        return;
      }
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'hash' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
      req.onblocked = () => { dbPromise = null; reject(new Error('IndexedDB open blocked')); };
    });
    return dbPromise;
  }

  /** Runs one request in a transaction. */
  async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    async get(hash) {
      try {
        return (await run<ContentPluginPackage | undefined>('readonly', s => s.get(hash))) ?? null;
      }
      catch {
        return fallback.get(hash);
      }
    },
    async put(pkg) {
      try {
        await run('readwrite', s => s.put(pkg));
      }
      catch (err) {
        console.warn('[plugin-cache] IndexedDB write failed, keeping in memory:', err);
        await fallback.put(pkg);
      }
    },
    async all() {
      try {
        return await run<ContentPluginPackage[]>('readonly', s => s.getAll());
      }
      catch {
        return fallback.all();
      }
    },
  };
}

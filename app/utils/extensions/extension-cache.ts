/**
 * Local cache of extension bundles (ADR §5.9): IndexedDB store
 * `pm-extensions`, keyed `id@version`. Bundles are immutable per version.
 * `createMemoryBundleCache` serves tests and browsers without IndexedDB.
 */

/** A cached bundle. */
export interface CachedBundle {
  /** `id@version`. */
  key: string;
  id: string;
  version: string;
  js: string;
  css: string | null;
  /** `extension.json` metadata. */
  info: Record<string, unknown>;
}

/** Bundle cache. */
export interface BundleCache {
  get(id: string, version: string): Promise<CachedBundle | null>;
  put(bundle: CachedBundle): Promise<void>;
  /** All cached versions of an id. */
  versions(id: string): Promise<string[]>;
  /** Every cached bundle (listings). */
  all(): Promise<CachedBundle[]>;
}

/** In-memory cache. */
export function createMemoryBundleCache(): BundleCache {
  const map = new Map<string, CachedBundle>();
  return {
    get: async (id, version) => map.get(`${id}@${version}`) ?? null,
    put: async (b) => { map.set(b.key, b); },
    versions: async id => [...map.values()].filter(b => b.id === id).map(b => b.version),
    all: async () => [...map.values()],
  };
}

const DB_NAME = 'pm-extensions';
const STORE = 'bundles';

/** IndexedDB cache (falls back to memory when IndexedDB fails). */
export function createIdbBundleCache(): BundleCache {
  const fallback = createMemoryBundleCache();
  let db: Promise<IDBDatabase> | null = null;

  /** Opens the database once. */
  function open(): Promise<IDBDatabase> {
    db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { db = null; reject(req.error); };
    });
    return db;
  }

  /** One request in a transaction. */
  async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const d = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = d.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    async get(id, version) {
      try { return (await run<CachedBundle | undefined>('readonly', s => s.get(`${id}@${version}`))) ?? null; }
      catch { return fallback.get(id, version); }
    },
    async put(b) {
      try { await run('readwrite', s => s.put(b)); }
      catch { await fallback.put(b); }
    },
    async versions(id) {
      try { return (await run<CachedBundle[]>('readonly', s => s.getAll())).filter(b => b.id === id).map(b => b.version); }
      catch { return fallback.versions(id); }
    },
    async all() {
      try { return await run<CachedBundle[]>('readonly', s => s.getAll()); }
      catch { return fallback.all(); }
    },
  };
}

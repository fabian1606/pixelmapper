import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { IndexedDbProjectStore } from './indexeddb-project-store';
import { runProjectStoreContract } from './project-store-contract';

/** IndexedDB store against fake-indexeddb; a fresh factory per test resets all data. */
let factory = new IDBFactory();

runProjectStoreContract('IndexedDB', {
  reset: () => {
    factory = new IDBFactory();
  },
  create: () => new IndexedDbProjectStore({ factory }),
  reopen: (previous) => {
    // Close the old connection like a page reload would.
    (previous as IndexedDbProjectStore).close();
    return new IndexedDbProjectStore({ factory });
  },
});

// ── IndexedDB-specific behaviour ─────────────────────────────────────────────

describe('IndexedDbProjectStore open handling', () => {
  it('rejects when IndexedDB is unavailable and retries on the next call', async () => {
    const store = new IndexedDbProjectStore();
    const original = globalThis.indexedDB;
    try {
      // @ts-expect-error simulate a missing IndexedDB
      delete globalThis.indexedDB;
      await expect(store.listProjects()).rejects.toThrow('IndexedDB not available');
      // The failure was not cached: once IndexedDB is back, calls succeed.
      globalThis.indexedDB = new IDBFactory();
      await expect(store.listProjects()).resolves.toEqual([]);
    }
    finally {
      globalThis.indexedDB = original;
    }
  });

  it('releases the connection on versionchange and reopens on the next call', async () => {
    const f = new IDBFactory();
    const store = new IndexedDbProjectStore({ factory: f, dbName: 'vc-test' });
    await store.appendOutbox({ id: 'a', projectId: 'p1', kind: 'command', type: 'T', payload: null, enqueuedAt: 1 });
    // "Another tab" deletes the DB; this only succeeds (not blocked) if our
    // connection closes itself in `onversionchange`.
    await new Promise<void>((resolve, reject) => {
      const req = f.deleteDatabase('vc-test');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
    await expect(store.countPending()).resolves.toBe(0);
  });
});

import type { ProjectStore } from './types';
import { IndexedDbProjectStore } from './indexeddb-project-store';
import { InMemoryProjectStore } from './in-memory-project-store';

/**
 * Entry point of the local project store (ADR 0004 D1, D12).
 *
 * `getProjectStore()` returns one shared `ProjectStore`: IndexedDB when it
 * can be opened, otherwise an in-memory fallback (data is then lost on
 * reload, which is logged as a warning).
 */

export type { LocalProjectMeta, NewOutboxEntry, OutboxEntry, ProjectStore } from './types';
export { IndexedDbProjectStore } from './indexeddb-project-store';
export type { IndexedDbProjectStoreOptions } from './indexeddb-project-store';
export { InMemoryProjectStore, createInMemoryProjectStoreState } from './in-memory-project-store';
export type { InMemoryProjectStoreState } from './in-memory-project-store';
export { migrateLegacyWal, LEGACY_WAL_DB_NAME, LEGACY_WAL_STORE } from './legacy-wal-migration';
export type { LegacyWalMigrationResult } from './legacy-wal-migration';

let storePromise: Promise<ProjectStore> | null = null;

/** Probes IndexedDB and falls back to memory when it cannot be opened. */
async function createProjectStore(): Promise<ProjectStore> {
  const idbStore = new IndexedDbProjectStore();
  try {
    await idbStore.ready();
    return idbStore;
  }
  catch (err) {
    console.warn('[project-store] IndexedDB unavailable, using in-memory store (changes will not survive a reload)', err);
    return new InMemoryProjectStore();
  }
}

/** Shared project store singleton. */
export function getProjectStore(): Promise<ProjectStore> {
  if (!storePromise) storePromise = createProjectStore();
  return storePromise;
}

/** Drops the singleton (tests only). */
export function resetProjectStoreForTests(): void {
  storePromise = null;
}

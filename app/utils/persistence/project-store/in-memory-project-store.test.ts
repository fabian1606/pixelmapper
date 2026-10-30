import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryProjectStore, createInMemoryProjectStoreState } from './in-memory-project-store';
import { runProjectStoreContract } from './project-store-contract';
import { getProjectStore, resetProjectStoreForTests } from './index';

/** Memory store; a shared state object emulates reopening a persistent store. */
let state = createInMemoryProjectStoreState();

runProjectStoreContract('in-memory', {
  reset: () => {
    state = createInMemoryProjectStoreState();
  },
  create: () => new InMemoryProjectStore(state),
  reopen: () => new InMemoryProjectStore(state),
});

// ── Singleton fallback ───────────────────────────────────────────────────────

describe('getProjectStore', () => {
  it('falls back to memory with a warning when IndexedDB is unavailable', async () => {
    const original = globalThis.indexedDB;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // @ts-expect-error simulate a missing IndexedDB
      delete globalThis.indexedDB;
      resetProjectStoreForTests();
      const store = await getProjectStore();
      expect(store).toBeInstanceOf(InMemoryProjectStore);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(await getProjectStore()).toBe(store);
    }
    finally {
      globalThis.indexedDB = original;
      warn.mockRestore();
      resetProjectStoreForTests();
    }
  });

  it('uses IndexedDB when available', async () => {
    resetProjectStoreForTests();
    const store = await getProjectStore();
    expect(store).not.toBeInstanceOf(InMemoryProjectStore);
    resetProjectStoreForTests();
  });
});

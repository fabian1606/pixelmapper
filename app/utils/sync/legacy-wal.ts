import { getProjectStore, migrateLegacyWal } from '~/utils/persistence/project-store';

/**
 * One-time move of the old IndexedDB WAL (`pixelmapper-wal`) into the outbox
 * (wp-store.md). Safe now that nothing writes the WAL any more. Memoized per
 * session; the migration itself is idempotent across sessions.
 */

let migration: Promise<void> | null = null;

/** Run the migration once; never rejects. */
export function ensureLegacyWalMigrated(): Promise<void> {
  migration ??= (async () => {
    try {
      const store = await getProjectStore();
      const result = await migrateLegacyWal(store);
      if (result.migrated > 0) console.info(`[sync] moved ${result.migrated} legacy WAL change(s) into the outbox`);
    }
    catch (err) {
      console.warn('[sync] legacy WAL migration failed:', err);
    }
  })();
  return migration;
}

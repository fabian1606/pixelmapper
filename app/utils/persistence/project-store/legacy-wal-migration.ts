import type { NewOutboxEntry, OutboxEntry, ProjectStore } from './types';
import { requestToPromise, runTransaction } from './idb-helpers';

/**
 * One-time migration of the legacy write-ahead log (`pixelmapper-wal` /
 * `pending-changes`, see `app/utils/persistence/wal.ts`) into the outbox of
 * a `ProjectStore` (ADR 0004 WP-STORE).
 *
 * Idempotent and crash-safe: entries are appended first and deleted from the
 * legacy DB afterwards; entries whose id is already in the outbox are not
 * appended again, so an interrupted run can simply be repeated.
 */

/** Legacy database name (wal.ts). */
export const LEGACY_WAL_DB_NAME = 'pixelmapper-wal';
/** Legacy object store name (wal.ts). */
export const LEGACY_WAL_STORE = 'pending-changes';

/**
 * Legacy record shape. `kind`, `dedupKey` and `type` are optional because
 * older entries only carry `commandType`.
 */
interface LegacyWalRecord {
  id?: unknown;
  projectId?: unknown;
  commandType?: unknown;
  type?: unknown;
  kind?: unknown;
  dedupKey?: unknown;
  payload?: unknown;
  enqueuedAt?: unknown;
}

/** Result of a migration run. */
export interface LegacyWalMigrationResult {
  /** Entries appended to the outbox in this run. */
  migrated: number;
  /** Entries already present in (or superseded inside) the outbox. */
  skipped: number;
  /** Malformed entries left untouched in the legacy DB. */
  invalid: number;
}

/** Options for `migrateLegacyWal`. */
export interface LegacyWalMigrationOptions {
  /** IDBFactory to use (default: global `indexedDB`). */
  factory?: IDBFactory;
}

const EMPTY_RESULT: LegacyWalMigrationResult = { migrated: 0, skipped: 0, invalid: 0 };

// ── Legacy DB access ─────────────────────────────────────────────────────────

/**
 * Opens the legacy DB at its current version WITHOUT creating it: if it
 * does not exist the upgrade is aborted and `null` is returned.
 */
function openLegacyDb(factory: IDBFactory): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    let missing = false;
    const req = factory.open(LEGACY_WAL_DB_NAME);
    req.onupgradeneeded = (event) => {
      // oldVersion 0 → the DB did not exist; abort so we don't create it.
      if (event.oldVersion === 0) {
        missing = true;
        req.transaction?.abort();
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      if (!db.objectStoreNames.contains(LEGACY_WAL_STORE)) {
        db.close();
        resolve(null);
        return;
      }
      resolve(db);
    };
    req.onerror = () => (missing ? resolve(null) : reject(req.error));
    req.onblocked = () => reject(new Error('Legacy WAL open blocked'));
  });
}

/** Converts a legacy record into an outbox input, or `null` if malformed. */
function toOutboxEntry(record: LegacyWalRecord): NewOutboxEntry | null {
  const type = typeof record.type === 'string' ? record.type : record.commandType;
  if (typeof record.id !== 'string' || record.id.length === 0) return null;
  if (typeof record.projectId !== 'string' || record.projectId.length === 0) return null;
  if (typeof type !== 'string') return null;
  const entry: NewOutboxEntry = {
    id: record.id,
    projectId: record.projectId,
    kind: record.kind === 'live-op' ? 'live-op' : 'command',
    type,
    payload: record.payload,
    enqueuedAt: typeof record.enqueuedAt === 'number' ? record.enqueuedAt : 0,
  };
  if (typeof record.dedupKey === 'string') entry.dedupKey = record.dedupKey;
  return entry;
}

// ── Migration ────────────────────────────────────────────────────────────────

/** Decides whether `entry` still has to be appended to `outbox`. */
function needsAppend(entry: NewOutboxEntry, outbox: OutboxEntry[]): boolean {
  if (outbox.some(pending => pending.id === entry.id)) return false;
  if (entry.dedupKey === undefined) return true;
  // A same-key entry that is at least as new already supersedes this one.
  return !outbox.some(pending => pending.dedupKey === entry.dedupKey && pending.enqueuedAt >= entry.enqueuedAt);
}

/**
 * Moves all legacy WAL entries into `store`'s outbox (ordered by
 * `enqueuedAt`) and deletes the moved entries from the legacy DB.
 * Resolves with zero counts when the legacy DB does not exist or
 * IndexedDB is unavailable.
 */
export async function migrateLegacyWal(
  store: ProjectStore,
  options: LegacyWalMigrationOptions = {},
): Promise<LegacyWalMigrationResult> {
  const factory = options.factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);
  if (!factory) return { ...EMPTY_RESULT };

  const db = await openLegacyDb(factory);
  if (!db) return { ...EMPTY_RESULT };

  try {
    const records = await runTransaction(db, [LEGACY_WAL_STORE], 'readonly', tx =>
      requestToPromise(tx.objectStore(LEGACY_WAL_STORE).getAll() as IDBRequest<LegacyWalRecord[]>));

    const result: LegacyWalMigrationResult = { ...EMPTY_RESULT };
    const valid: NewOutboxEntry[] = [];
    for (const record of records) {
      const entry = toOutboxEntry(record);
      if (entry) valid.push(entry);
      else result.invalid++;
    }
    if (result.invalid > 0) console.warn(`[project-store] ${result.invalid} malformed legacy WAL entries left in place`);

    // Stable sort keeps the key order for equal timestamps.
    valid.sort((a, b) => a.enqueuedAt - b.enqueuedAt);

    const outboxByProject = new Map<string, OutboxEntry[]>();
    for (const entry of valid) {
      let outbox = outboxByProject.get(entry.projectId);
      if (!outbox) {
        outbox = await store.getOutbox(entry.projectId);
        outboxByProject.set(entry.projectId, outbox);
      }
      if (!needsAppend(entry, outbox)) {
        result.skipped++;
        continue;
      }
      const stored = await store.appendOutbox(entry);
      // Mirror the store's dedup replacement in the local view.
      const remaining = entry.dedupKey === undefined
        ? outbox
        : outbox.filter(pending => pending.dedupKey !== entry.dedupKey);
      outboxByProject.set(entry.projectId, [...remaining, stored]);
      result.migrated++;
    }

    // Only now (everything durable in the outbox) drop the legacy entries.
    if (valid.length > 0) {
      await runTransaction(db, [LEGACY_WAL_STORE], 'readwrite', (tx) => {
        const legacy = tx.objectStore(LEGACY_WAL_STORE);
        for (const entry of valid) legacy.delete(entry.id);
      });
    }
    if (result.migrated > 0) console.info(`[project-store] migrated ${result.migrated} legacy WAL entries into the outbox`);
    return result;
  }
  finally {
    db.close();
  }
}

import type { ProjectSnapshot } from '~/utils/engine/serialize';
import type { LocalProjectMeta, NewOutboxEntry, OutboxEntry, ProjectStore } from './types';
import {
  ALL_STORES,
  BASE_STORE,
  COUNTER_STORE,
  META_STORE,
  OUTBOX_BY_ORDER,
  OUTBOX_BY_PROJECT_DEDUP,
  OUTBOX_BY_PROJECT_ORDER,
  OUTBOX_ORDER_COUNTER,
  OUTBOX_STORE,
  PROJECT_DB_NAME,
  WORKING_STORE,
  createDbOpener,
  requestToPromise,
  runTransaction,
} from './idb-helpers';

/**
 * IndexedDB implementation of `ProjectStore` (ADR 0004 D1, D12, §3.1).
 *
 * - Every write resolves only after its transaction committed.
 * - Multi-store changes (deleteProject, putBaseSnapshot + meta cursor,
 *   appendOutbox + order counter) run in ONE transaction, so they are atomic.
 * - The outbox `order` comes from a persisted counter, so ordering stays
 *   monotonic across reloads and store instances.
 */

/** Record shape of the snapshot object stores. */
interface SnapshotRecord {
  projectId: string;
  snapshot: ProjectSnapshot;
}

/** Record shape of the counter object store. */
interface CounterRecord {
  name: string;
  value: number;
}

/** Options for `IndexedDbProjectStore`. */
export interface IndexedDbProjectStoreOptions {
  /** Database name (default `pixelmapper-projects`). */
  dbName?: string;
  /** IDBFactory to use (default: the global `indexedDB`, read lazily). */
  factory?: IDBFactory;
}

/** Key range matching every `[projectId, *]` key of a compound index. */
function projectRange(projectId: string): IDBKeyRange {
  return IDBKeyRange.bound([projectId, -Infinity], [projectId, Infinity]);
}

export class IndexedDbProjectStore implements ProjectStore {
  private readonly opener: ReturnType<typeof createDbOpener>;

  constructor(options: IndexedDbProjectStoreOptions = {}) {
    const factory = options.factory;
    this.opener = createDbOpener(
      options.dbName ?? PROJECT_DB_NAME,
      () => factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB),
    );
  }

  /** Opens the database; used by `getProjectStore()` to probe availability. */
  async ready(): Promise<void> {
    await this.opener.open();
  }

  /** Closes the underlying connection (tests). The next call reopens. */
  close(): void {
    this.opener.close();
  }

  // ── Project meta ───────────────────────────────────────────────────────────

  async listProjects(): Promise<LocalProjectMeta[]> {
    const db = await this.opener.open();
    return runTransaction(db, [META_STORE], 'readonly', tx =>
      requestToPromise(tx.objectStore(META_STORE).getAll() as IDBRequest<LocalProjectMeta[]>));
  }

  async getProject(id: string): Promise<LocalProjectMeta | null> {
    const db = await this.opener.open();
    const meta = await runTransaction(db, [META_STORE], 'readonly', tx =>
      requestToPromise(tx.objectStore(META_STORE).get(id) as IDBRequest<LocalProjectMeta | undefined>));
    return meta ?? null;
  }

  async putProject(meta: LocalProjectMeta): Promise<void> {
    const db = await this.opener.open();
    await runTransaction(db, [META_STORE], 'readwrite', (tx) => {
      tx.objectStore(META_STORE).put(meta);
    });
  }

  async deleteProject(id: string): Promise<void> {
    const db = await this.opener.open();
    await runTransaction(db, [META_STORE, BASE_STORE, WORKING_STORE, OUTBOX_STORE], 'readwrite', async (tx) => {
      tx.objectStore(META_STORE).delete(id);
      tx.objectStore(BASE_STORE).delete(id);
      tx.objectStore(WORKING_STORE).delete(id);
      const outbox = tx.objectStore(OUTBOX_STORE);
      const keys = await requestToPromise(outbox.index(OUTBOX_BY_PROJECT_ORDER).getAllKeys(projectRange(id)));
      for (const key of keys) outbox.delete(key);
    });
  }

  // ── Snapshots ──────────────────────────────────────────────────────────────

  async getBaseSnapshot(id: string): Promise<ProjectSnapshot | null> {
    return this.getSnapshot(BASE_STORE, id);
  }

  async putBaseSnapshot(id: string, snapshot: ProjectSnapshot, serverCursor: number): Promise<void> {
    const db = await this.opener.open();
    // Snapshot and cursor must never diverge, so both go into one transaction.
    await runTransaction(db, [BASE_STORE, META_STORE], 'readwrite', async (tx) => {
      tx.objectStore(BASE_STORE).put({ projectId: id, snapshot } satisfies SnapshotRecord);
      const metaStore = tx.objectStore(META_STORE);
      const meta = await requestToPromise(metaStore.get(id) as IDBRequest<LocalProjectMeta | undefined>);
      if (meta) metaStore.put({ ...meta, serverCursor });
    });
  }

  async getWorkingSnapshot(id: string): Promise<ProjectSnapshot | null> {
    return this.getSnapshot(WORKING_STORE, id);
  }

  async putWorkingSnapshot(id: string, snapshot: ProjectSnapshot): Promise<void> {
    const db = await this.opener.open();
    await runTransaction(db, [WORKING_STORE], 'readwrite', (tx) => {
      tx.objectStore(WORKING_STORE).put({ projectId: id, snapshot } satisfies SnapshotRecord);
    });
  }

  /** Reads one snapshot record from `storeName`. */
  private async getSnapshot(storeName: string, id: string): Promise<ProjectSnapshot | null> {
    const db = await this.opener.open();
    const record = await runTransaction(db, [storeName], 'readonly', tx =>
      requestToPromise(tx.objectStore(storeName).get(id) as IDBRequest<SnapshotRecord | undefined>));
    return record?.snapshot ?? null;
  }

  // ── Outbox ─────────────────────────────────────────────────────────────────

  async appendOutbox(entry: NewOutboxEntry): Promise<OutboxEntry> {
    const db = await this.opener.open();
    return runTransaction(db, [OUTBOX_STORE, COUNTER_STORE], 'readwrite', async (tx) => {
      const outbox = tx.objectStore(OUTBOX_STORE);
      const counters = tx.objectStore(COUNTER_STORE);

      // Next order = max(persisted counter, highest stored order) + 1. The
      // max-scan makes the counter self-healing should it ever be lost.
      const counter = await requestToPromise(counters.get(OUTBOX_ORDER_COUNTER) as IDBRequest<CounterRecord | undefined>);
      const lastCursor = await requestToPromise(outbox.index(OUTBOX_BY_ORDER).openCursor(null, 'prev'));
      const lastOrder = (lastCursor?.value as OutboxEntry | undefined)?.order ?? 0;
      const order = Math.max(counter?.value ?? 0, lastOrder) + 1;
      counters.put({ name: OUTBOX_ORDER_COUNTER, value: order } satisfies CounterRecord);

      // Coalescing (D8): drop the pending entry with the same dedupKey.
      if (entry.dedupKey !== undefined) {
        const dedupIndex = outbox.index(OUTBOX_BY_PROJECT_DEDUP);
        const keys = await requestToPromise(dedupIndex.getAllKeys([entry.projectId, entry.dedupKey]));
        for (const key of keys) outbox.delete(key);
      }

      const stored: OutboxEntry = { ...entry, order };
      outbox.put(stored);
      return stored;
    });
  }

  async getOutbox(projectId: string): Promise<OutboxEntry[]> {
    const db = await this.opener.open();
    // The compound index already yields entries sorted by `order`.
    return runTransaction(db, [OUTBOX_STORE], 'readonly', tx =>
      requestToPromise(
        tx.objectStore(OUTBOX_STORE).index(OUTBOX_BY_PROJECT_ORDER).getAll(projectRange(projectId)) as IDBRequest<OutboxEntry[]>,
      ));
  }

  async updateOutbox(entries: OutboxEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const db = await this.opener.open();
    await runTransaction(db, [OUTBOX_STORE], 'readwrite', async (tx) => {
      const outbox = tx.objectStore(OUTBOX_STORE);
      for (const entry of entries) {
        const existing = await requestToPromise(outbox.get(entry.id) as IDBRequest<OutboxEntry | undefined>);
        // Acked meanwhile → nothing to rewrite. Order/project stay authoritative.
        if (!existing) continue;
        outbox.put({ ...entry, projectId: existing.projectId, order: existing.order });
      }
    });
  }

  async ackOutbox(ids: string[]): Promise<void> {
    const validIds = ids.filter(id => typeof id === 'string' && id.length > 0);
    if (validIds.length === 0) return;
    const db = await this.opener.open();
    await runTransaction(db, [OUTBOX_STORE], 'readwrite', (tx) => {
      const outbox = tx.objectStore(OUTBOX_STORE);
      for (const id of validIds) outbox.delete(id);
    });
  }

  async countPending(projectId?: string): Promise<number> {
    const db = await this.opener.open();
    return runTransaction(db, [OUTBOX_STORE], 'readonly', (tx) => {
      const outbox = tx.objectStore(OUTBOX_STORE);
      if (projectId === undefined) return requestToPromise(outbox.count());
      return requestToPromise(outbox.index(OUTBOX_BY_PROJECT_ORDER).count(projectRange(projectId)));
    });
  }

  // ── Maintenance ────────────────────────────────────────────────────────────

  async clearAll(): Promise<void> {
    const db = await this.opener.open();
    // The order counter survives on purpose: `order` stays strictly
    // monotonic for the lifetime of the database, even across logouts.
    const stores = ALL_STORES.filter(name => name !== COUNTER_STORE);
    await runTransaction(db, stores, 'readwrite', (tx) => {
      for (const name of stores) tx.objectStore(name).clear();
    });
  }
}

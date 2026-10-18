import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProjectSnapshot } from '~/utils/engine/serialize';
import type { LocalProjectMeta, NewOutboxEntry, ProjectStore } from './types';
import { LEGACY_WAL_DB_NAME, LEGACY_WAL_STORE, migrateLegacyWal } from './legacy-wal-migration';

/**
 * Shared contract test suite for `ProjectStore` implementations.
 *
 * Each implementation's `*.test.ts` calls `runProjectStoreContract` with a
 * harness; the same assertions then run against IndexedDB and memory.
 */

/** Per-implementation hooks. */
export interface ProjectStoreHarness {
  /** Creates a fresh, empty backend (called before every test). */
  reset(): void | Promise<void>;
  /** New store instance on the current backend. */
  create(): ProjectStore;
  /** Simulates a reload: a new instance on the SAME backend. */
  reopen(previous: ProjectStore): ProjectStore;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Minimal project meta. */
function meta(id: string, overrides: Partial<LocalProjectMeta> = {}): LocalProjectMeta {
  return {
    id,
    name: `Project ${id}`,
    origin: 'local',
    ownerUserId: null,
    serverCursor: 0,
    createdAt: 1,
    updatedAt: 1,
    lastSyncedAt: null,
    ...overrides,
  };
}

/** Minimal snapshot (only the shape matters to the store). */
function snapshot(marker: string): ProjectSnapshot {
  return { schemaVersion: 1, sceneNodes: [], savedPresets: [], pinnedModifiers: [], globalBases: { [marker]: 1 }, modifiers: [] } as unknown as ProjectSnapshot;
}

/** Outbox input with sensible defaults. */
function entry(id: string, projectId = 'p1', overrides: Partial<NewOutboxEntry> = {}): NewOutboxEntry {
  return { id, projectId, kind: 'command', type: 'TestCommand', payload: { id }, enqueuedAt: 1, ...overrides };
}

/** Creates the legacy WAL DB (same schema as wal.ts) and seeds `records`. */
async function seedLegacyWal(factory: IDBFactory, records: Record<string, unknown>[]): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(LEGACY_WAL_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(LEGACY_WAL_STORE, { keyPath: 'id' });
      store.createIndex('byProject', 'projectId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LEGACY_WAL_STORE, 'readwrite');
    for (const record of records) tx.objectStore(LEGACY_WAL_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Ids still present in the legacy WAL DB. */
async function legacyIds(factory: IDBFactory): Promise<string[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(LEGACY_WAL_DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const req = db.transaction(LEGACY_WAL_STORE, 'readonly').objectStore(LEGACY_WAL_STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return keys as string[];
}

// ── Suite ────────────────────────────────────────────────────────────────────

/** Registers the contract tests for one implementation. */
export function runProjectStoreContract(name: string, harness: ProjectStoreHarness): void {
  describe(`ProjectStore contract: ${name}`, () => {
    let store: ProjectStore;

    beforeEach(async () => {
      await harness.reset();
      store = harness.create();
    });

    describe('meta', () => {
      it('puts, gets, lists and replaces projects', async () => {
        expect(await store.getProject('p1')).toBeNull();
        await store.putProject(meta('p1'));
        await store.putProject(meta('p2'));
        await store.putProject(meta('p1', { name: 'Renamed' }));
        expect((await store.getProject('p1'))?.name).toBe('Renamed');
        expect((await store.listProjects()).map(p => p.id).sort()).toEqual(['p1', 'p2']);
      });

      it('returns copies, not live references', async () => {
        const m = meta('p1');
        await store.putProject(m);
        m.name = 'mutated';
        expect((await store.getProject('p1'))?.name).toBe('Project p1');
      });
    });

    describe('snapshots', () => {
      it('stores base and working snapshots independently', async () => {
        expect(await store.getBaseSnapshot('p1')).toBeNull();
        expect(await store.getWorkingSnapshot('p1')).toBeNull();
        await store.putBaseSnapshot('p1', snapshot('base'), 0);
        await store.putWorkingSnapshot('p1', snapshot('work'));
        expect((await store.getBaseSnapshot('p1'))?.globalBases).toEqual({ base: 1 });
        expect((await store.getWorkingSnapshot('p1'))?.globalBases).toEqual({ work: 1 });
      });

      it('putBaseSnapshot advances meta.serverCursor', async () => {
        await store.putProject(meta('p1', { name: 'Keep' }));
        await store.putBaseSnapshot('p1', snapshot('base'), 42);
        const m = await store.getProject('p1');
        expect(m?.serverCursor).toBe(42);
        expect(m?.name).toBe('Keep');
      });

      it('putBaseSnapshot without meta does not create meta', async () => {
        await store.putBaseSnapshot('p1', snapshot('base'), 7);
        expect(await store.getProject('p1')).toBeNull();
      });
    });

    describe('outbox', () => {
      it('assigns monotonic order and returns entries ordered per project', async () => {
        const a = await store.appendOutbox(entry('a'));
        const b = await store.appendOutbox(entry('b', 'p2'));
        const c = await store.appendOutbox(entry('c'));
        expect(a.order).toBeLessThan(b.order);
        expect(b.order).toBeLessThan(c.order);
        expect((await store.getOutbox('p1')).map(e => e.id)).toEqual(['a', 'c']);
        expect((await store.getOutbox('p2')).map(e => e.id)).toEqual(['b']);
        expect(await store.getOutbox('unknown')).toEqual([]);
      });

      it('orders by append order, not by enqueuedAt', async () => {
        await store.appendOutbox(entry('late', 'p1', { enqueuedAt: 100 }));
        await store.appendOutbox(entry('early', 'p1', { enqueuedAt: 1 }));
        expect((await store.getOutbox('p1')).map(e => e.id)).toEqual(['late', 'early']);
      });

      it('replaces a pending entry with the same dedupKey and moves it to the end', async () => {
        await store.appendOutbox(entry('x1', 'p1', { kind: 'live-op', dedupKey: 'fader:1', payload: 1 }));
        await store.appendOutbox(entry('cmd'));
        const x2 = await store.appendOutbox(entry('x2', 'p1', { kind: 'live-op', dedupKey: 'fader:1', payload: 2 }));
        const outbox = await store.getOutbox('p1');
        expect(outbox.map(e => e.id)).toEqual(['cmd', 'x2']);
        expect(outbox[1]).toEqual(x2);
        expect(outbox[1]?.payload).toBe(2);
      });

      it('scopes dedupKey per project and keeps different keys', async () => {
        await store.appendOutbox(entry('a', 'p1', { dedupKey: 'k' }));
        await store.appendOutbox(entry('b', 'p2', { dedupKey: 'k' }));
        await store.appendOutbox(entry('c', 'p1', { dedupKey: 'other' }));
        expect((await store.getOutbox('p1')).map(e => e.id)).toEqual(['a', 'c']);
        expect((await store.getOutbox('p2')).map(e => e.id)).toEqual(['b']);
      });

      it('updateOutbox replaces payloads but keeps order; unknown ids are ignored', async () => {
        await store.appendOutbox(entry('a'));
        await store.appendOutbox(entry('b'));
        const [a, b] = await store.getOutbox('p1');
        await store.updateOutbox([
          { ...b!, payload: 'rebased-b', order: 999 },
          { ...a!, payload: 'rebased-a' },
          { ...a!, id: 'ghost' },
        ]);
        const outbox = await store.getOutbox('p1');
        expect(outbox.map(e => [e.id, e.payload, e.order])).toEqual([
          ['a', 'rebased-a', a!.order],
          ['b', 'rebased-b', b!.order],
        ]);
        expect(await store.countPending()).toBe(2);
      });

      it('acks entries and ignores unknown ids', async () => {
        await store.appendOutbox(entry('a'));
        await store.appendOutbox(entry('b'));
        await store.ackOutbox(['a', 'unknown', '']);
        await store.ackOutbox([]);
        expect((await store.getOutbox('p1')).map(e => e.id)).toEqual(['b']);
      });

      it('counts pending entries per project and in total', async () => {
        expect(await store.countPending()).toBe(0);
        await store.appendOutbox(entry('a'));
        await store.appendOutbox(entry('b'));
        await store.appendOutbox(entry('c', 'p2'));
        expect(await store.countPending('p1')).toBe(2);
        expect(await store.countPending('p2')).toBe(1);
        expect(await store.countPending('p3')).toBe(0);
        expect(await store.countPending()).toBe(3);
      });

      it('persists data and the order counter across store instances', async () => {
        await store.putProject(meta('p1'));
        const a = await store.appendOutbox(entry('a'));
        const b = await store.appendOutbox(entry('b'));
        // Acking the newest entry must not let the counter go backwards.
        await store.ackOutbox(['b']);
        const reopened = harness.reopen(store);
        expect(await reopened.getProject('p1')).not.toBeNull();
        expect((await reopened.getOutbox('p1')).map(e => e.id)).toEqual(['a']);
        const c = await reopened.appendOutbox(entry('c'));
        expect(c.order).toBeGreaterThan(b.order);
        expect(c.order).toBeGreaterThan(a.order);
      });
    });

    describe('cascades', () => {
      it('deleteProject removes meta, snapshots and outbox of that project only', async () => {
        for (const id of ['p1', 'p2']) {
          await store.putProject(meta(id));
          await store.putBaseSnapshot(id, snapshot(id), 1);
          await store.putWorkingSnapshot(id, snapshot(id));
          await store.appendOutbox(entry(`${id}-a`, id));
          await store.appendOutbox(entry(`${id}-b`, id, { dedupKey: 'k' }));
        }
        await store.deleteProject('p1');
        expect(await store.getProject('p1')).toBeNull();
        expect(await store.getBaseSnapshot('p1')).toBeNull();
        expect(await store.getWorkingSnapshot('p1')).toBeNull();
        expect(await store.countPending('p1')).toBe(0);
        expect(await store.getProject('p2')).not.toBeNull();
        expect(await store.getBaseSnapshot('p2')).not.toBeNull();
        expect(await store.countPending('p2')).toBe(2);
      });

      it('clearAll removes everything but keeps order monotonic', async () => {
        await store.putProject(meta('p1'));
        await store.putBaseSnapshot('p1', snapshot('b'), 1);
        await store.putWorkingSnapshot('p1', snapshot('w'));
        const a = await store.appendOutbox(entry('a'));
        await store.clearAll();
        expect(await store.listProjects()).toEqual([]);
        expect(await store.getBaseSnapshot('p1')).toBeNull();
        expect(await store.getWorkingSnapshot('p1')).toBeNull();
        expect(await store.countPending()).toBe(0);
        expect((await store.appendOutbox(entry('b'))).order).toBeGreaterThan(a.order);
      });
    });

    describe('legacy WAL migration', () => {
      let legacy: IDBFactory;
      beforeEach(() => {
        legacy = new IDBFactory();
      });

      it('is a no-op when the legacy DB does not exist (and does not create it)', async () => {
        expect(await migrateLegacyWal(store, { factory: legacy })).toEqual({ migrated: 0, skipped: 0, invalid: 0 });
        expect((await legacy.databases()).map(d => d.name)).not.toContain(LEGACY_WAL_DB_NAME);
      });

      it('moves entries ordered by enqueuedAt and clears them', async () => {
        await seedLegacyWal(legacy, [
          { id: 'c', projectId: 'p1', commandType: 'C', payload: 3, enqueuedAt: 30 },
          { id: 'a', projectId: 'p1', commandType: 'A', payload: 1, enqueuedAt: 10 },
          { id: 'b', projectId: 'p2', commandType: 'B', payload: 2, enqueuedAt: 20 },
          { id: 'l', projectId: 'p1', commandType: 'SetFader', kind: 'live-op', dedupKey: 'f', payload: 4, enqueuedAt: 40 },
        ]);
        const result = await migrateLegacyWal(store, { factory: legacy });
        expect(result).toEqual({ migrated: 4, skipped: 0, invalid: 0 });
        const p1 = await store.getOutbox('p1');
        expect(p1.map(e => [e.id, e.kind, e.type, e.payload, e.enqueuedAt])).toEqual([
          ['a', 'command', 'A', 1, 10],
          ['c', 'command', 'C', 3, 30],
          ['l', 'live-op', 'SetFader', 4, 40],
        ]);
        expect(p1[2]?.dedupKey).toBe('f');
        expect(p1[0]?.dedupKey).toBeUndefined();
        expect((await store.getOutbox('p2')).map(e => e.id)).toEqual(['b']);
        expect(await legacyIds(legacy)).toEqual([]);
      });

      it('is idempotent, also after an interrupted run', async () => {
        const records = [
          { id: 'a', projectId: 'p1', commandType: 'A', payload: 1, enqueuedAt: 10 },
          { id: 'f1', projectId: 'p1', commandType: 'F', kind: 'live-op', dedupKey: 'f', payload: 1, enqueuedAt: 20 },
          { id: 'f2', projectId: 'p1', commandType: 'F', kind: 'live-op', dedupKey: 'f', payload: 2, enqueuedAt: 30 },
        ];
        await seedLegacyWal(legacy, records);
        await migrateLegacyWal(store, { factory: legacy });
        // Simulate a crash before the legacy delete: the entries reappear.
        await seedLegacyWal(legacy, records);
        const second = await migrateLegacyWal(store, { factory: legacy });
        expect(second.migrated).toBe(0);
        expect((await store.getOutbox('p1')).map(e => [e.id, e.payload])).toEqual([['a', 1], ['f2', 2]]);
        expect(await legacyIds(legacy)).toEqual([]);
        expect(await migrateLegacyWal(store, { factory: legacy })).toEqual({ migrated: 0, skipped: 0, invalid: 0 });
      });

      it('leaves malformed entries in the legacy DB', async () => {
        await seedLegacyWal(legacy, [
          { id: 'ok', projectId: 'p1', commandType: 'A', payload: 1, enqueuedAt: 1 },
          { id: 'bad', commandType: 'A', payload: 1, enqueuedAt: 2 },
        ]);
        const result = await migrateLegacyWal(store, { factory: legacy });
        expect(result).toEqual({ migrated: 1, skipped: 0, invalid: 1 });
        expect(await legacyIds(legacy)).toEqual(['bad']);
      });
    });
  });
}

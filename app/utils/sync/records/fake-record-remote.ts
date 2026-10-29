/**
 * In-memory `RecordRemote` mimicking the `user_records` table of migration
 * 008 (LWW trigger, server write clock, keyset pull). Test helper only.
 */
import { IDBFactory } from 'fake-indexeddb';
import { closeRecordDb } from './record-db';
import type { PullCursor, RecordRemote, UserRecordRow, UserRecordRowInput } from './types';

/** A fake server shared by several fake devices. */
export interface FakeRecordServer extends RecordRemote {
  rows: Map<string, UserRecordRow>;
  /** When true every call throws like `fetch` does offline. */
  offline: boolean;
  /** Number of upsert calls. */
  upsertCalls: number;
}

/** Creates an empty fake server. */
export function createFakeRecordServer(): FakeRecordServer {
  let clock = Date.parse('2026-01-01T00:00:00.000Z');
  /** Monotonic server write time. */
  const tick = () => new Date(clock++).toISOString();

  const server: FakeRecordServer = {
    rows: new Map(),
    offline: false,
    upsertCalls: 0,

    async upsert(rows: UserRecordRowInput[]): Promise<string[]> {
      if (server.offline) throw new TypeError('Failed to fetch');
      server.upsertCalls++;
      const accepted: string[] = [];
      for (const row of rows) {
        const stored = server.rows.get(row.id);
        // LWW trigger: skip writes older than the stored row.
        if (stored && Date.parse(row.updated_at) < Date.parse(stored.updated_at)) continue;
        server.rows.set(row.id, structuredClone({ ...row, server_updated_at: tick() }));
        accepted.push(row.id);
      }
      return accepted;
    },

    async fetchByIds(ids: string[]): Promise<UserRecordRow[]> {
      if (server.offline) throw new TypeError('Failed to fetch');
      return ids.map(id => server.rows.get(id)).filter((r): r is UserRecordRow => !!r).map(r => structuredClone(r));
    },

    async pullPage(kind: string, after: PullCursor | null, limit: number): Promise<UserRecordRow[]> {
      if (server.offline) throw new TypeError('Failed to fetch');
      const key = (r: { ts: string; id: string }) => `${new Date(r.ts).toISOString()}|${r.id}`;
      return [...server.rows.values()]
        .filter(r => r.kind === kind)
        .filter(r => !after || key({ ts: r.server_updated_at, id: r.id }) > key(after))
        .sort((a, b) => key({ ts: a.server_updated_at, id: a.id }).localeCompare(key({ ts: b.server_updated_at, id: b.id })))
        .slice(0, limit)
        .map(r => structuredClone(r));
    },
  };
  return server;
}

/** Simulates switching to another device: a separate, empty IndexedDB. */
export async function useFreshDevice(): Promise<IDBFactory> {
  await closeRecordDb();
  const factory = new IDBFactory();
  globalThis.indexedDB = factory;
  return factory;
}

/** Switches back to a device created by `useFreshDevice`. */
export async function useDevice(factory: IDBFactory): Promise<void> {
  await closeRecordDb();
  globalThis.indexedDB = factory;
}

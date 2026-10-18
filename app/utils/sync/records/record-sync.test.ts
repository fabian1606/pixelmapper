/**
 * User record sync (WP-RECORDS): LWW, tombstones, offline → reconnect,
 * local-only records and the account hooks. Runs against fake-indexeddb
 * and an in-memory server mimicking migration 008.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeRecordServer, useDevice, useFreshDevice } from './fake-record-remote';
import type { FakeRecordServer } from './fake-record-remote';
import { getRecord, listRecords } from './record-db';
import { createRecordCollection } from './record-collection';
import {
  adoptLocalRecords,
  clearLocalRecords,
  configureRecordRemote,
  countPendingRecords,
  resetRecordSessionForTests,
  setRecordUser,
} from './record-session';
import { pullRemoteRecords, pushDirtyRecords } from './record-sync';
import { isOnline, reportNetworkSuccess } from '../connectivity';

const KIND = 'test-kind';
const USER = 'user-a';

interface Note { text: string }

let server: FakeRecordServer;

/**
 * A collection that never syncs on its own timers during a test. Waits for
 * the initial load and the initial sync a signed-in collection starts.
 */
async function notes() {
  const c = createRecordCollection<Note>(KIND, { debounceMs: 60_000 });
  await c.ready;
  await c.syncNow();
  return c;
}

beforeEach(async () => {
  await useFreshDevice();
  server = createFakeRecordServer();
  configureRecordRemote(server);
  reportNetworkSuccess();
});

afterEach(() => {
  resetRecordSessionForTests();
});

// ── Local only ───────────────────────────────────────────────────────────────

describe('without login', () => {
  it('keeps records local with ownerUserId null and never contacts the server', async () => {
    const c = await notes();
    const id = await c.put({ text: 'hello' });
    await c.syncNow();
    expect(c.items.value.map(i => i.data.text)).toEqual(['hello']);
    expect((await getRecord(id))?.ownerUserId).toBeNull();
    expect(server.upsertCalls).toBe(0);
  });

  it('deletes local-only records immediately (no tombstone)', async () => {
    const c = await notes();
    const id = await c.put({ text: 'x' });
    await c.remove(id);
    expect(await getRecord(id)).toBeUndefined();
    expect(c.items.value).toEqual([]);
  });

  it('adoptLocalRecords binds local records to the account and uploads them', async () => {
    const c = await notes();
    const id = await c.put({ text: 'local' });
    await setRecordUser(USER);
    expect(server.rows.size).toBe(0); // not uploaded automatically (D14)
    expect(await adoptLocalRecords(USER)).toBe(1);
    expect(server.rows.get(id)?.user_id).toBe(USER);
    expect((await getRecord(id))?.dirty).toBe(false);
  });
});

// ── Push / pull ──────────────────────────────────────────────────────────────

describe('signed in', () => {
  it('pushes new records and marks them clean', async () => {
    await setRecordUser(USER);
    const c = await notes();
    const id = await c.put({ text: 'a' });
    expect(await countPendingRecords(USER)).toBe(1);
    await c.syncNow();
    expect(server.rows.get(id)?.data).toEqual({ text: 'a' });
    expect(await countPendingRecords(USER)).toBe(0);
  });

  it('pulls records written by another device', async () => {
    await setRecordUser(USER);
    const deviceA = globalThis.indexedDB;
    const a = await notes();
    const id = await a.put({ text: 'from A' });
    await a.syncNow();

    resetRecordSessionForTests();
    configureRecordRemote(server);
    await useFreshDevice();
    await setRecordUser(USER);
    const b = await notes();
    await b.syncNow();
    expect(b.get(id)?.data.text).toBe('from A');
    await useDevice(deviceA);
  });
});

// ── LWW ──────────────────────────────────────────────────────────────────────

describe('last writer wins', () => {
  const ctx = () => ({ remote: server, kind: KIND, userId: USER });

  it('server row wins over an older local change', async () => {
    await setRecordUser(USER);
    const c = await notes();
    const id = await c.put({ text: 'old local' });
    const local = (await getRecord(id))!;
    server.rows.set(id, {
      id, user_id: USER, kind: KIND, data: { text: 'newer remote' },
      updated_at: new Date(local.updatedAt + 10_000).toISOString(), deleted_at: null,
      server_updated_at: new Date(local.updatedAt + 10_000).toISOString(),
    });
    await pushDirtyRecords(ctx());
    const after = (await getRecord(id))!;
    expect(after.data).toEqual({ text: 'newer remote' });
    expect(after.dirty).toBe(false);
    expect(server.rows.get(id)?.data).toEqual({ text: 'newer remote' });
  });

  it('newer local change overwrites an older server row', async () => {
    await setRecordUser(USER);
    const c = await notes();
    const id = await c.put({ text: 'newer local' });
    const local = (await getRecord(id))!;
    server.rows.set(id, {
      id, user_id: USER, kind: KIND, data: { text: 'older remote' },
      updated_at: new Date(local.updatedAt - 10_000).toISOString(), deleted_at: null,
      server_updated_at: new Date(local.updatedAt - 10_000).toISOString(),
    });
    // Pull first: the dirty, newer local record must survive.
    await pullRemoteRecords(ctx());
    expect((await getRecord(id))?.data).toEqual({ text: 'newer local' });
    await pushDirtyRecords(ctx());
    expect(server.rows.get(id)?.data).toEqual({ text: 'newer local' });
  });

  it('pull replaces a clean local record with a newer remote one', async () => {
    await setRecordUser(USER);
    const c = await notes();
    const id = await c.put({ text: 'v1' });
    await c.syncNow();
    const row = server.rows.get(id)!;
    await server.upsert([{ ...row, data: { text: 'v2' }, updated_at: new Date(Date.parse(row.updated_at) + 1).toISOString() }]);
    await c.syncNow();
    expect(c.get(id)?.data.text).toBe('v2');
  });
});

// ── Tombstones ───────────────────────────────────────────────────────────────

describe('tombstones', () => {
  it('a local delete is pushed as tombstone and then removed locally', async () => {
    await setRecordUser(USER);
    const c = await notes();
    const id = await c.put({ text: 'doomed' });
    await c.syncNow();
    await c.remove(id);
    expect(c.items.value).toEqual([]);
    expect((await getRecord(id))?.deletedAt).not.toBeNull(); // pending tombstone
    await c.syncNow();
    expect(server.rows.get(id)?.deleted_at).not.toBeNull();
    expect(await getRecord(id)).toBeUndefined();
  });

  it('a remote tombstone deletes the local record', async () => {
    await setRecordUser(USER);
    const c = await notes();
    const id = await c.put({ text: 'shared' });
    await c.syncNow();
    const row = server.rows.get(id)!;
    const later = new Date(Date.parse(row.updated_at) + 1).toISOString();
    await server.upsert([{ ...row, updated_at: later, deleted_at: later }]);
    await c.syncNow();
    expect(c.get(id)).toBeUndefined();
    expect(await listRecords(KIND)).toEqual([]);
  });

  it('a newer local edit survives an older remote tombstone', async () => {
    await setRecordUser(USER);
    const c = await notes();
    const id = await c.put({ text: 'keep me' });
    const local = (await getRecord(id))!;
    server.rows.set(id, {
      id, user_id: USER, kind: KIND, data: {},
      updated_at: new Date(local.updatedAt - 1).toISOString(),
      deleted_at: new Date(local.updatedAt - 1).toISOString(),
      server_updated_at: new Date().toISOString(),
    });
    await c.syncNow();
    expect(c.get(id)?.data.text).toBe('keep me');
    expect(server.rows.get(id)?.deleted_at).toBeNull();
  });
});

// ── Offline → reconnect ──────────────────────────────────────────────────────

describe('offline', () => {
  it('keeps changes while offline and pushes them on reconnect', async () => {
    await setRecordUser(USER);
    const c = await notes();
    server.offline = true;
    const id = await c.put({ text: 'offline edit' });
    await c.syncNow();
    expect(c.status.value).toBe('offline');
    expect(isOnline.value).toBe(false);
    expect(c.get(id)?.data.text).toBe('offline edit');
    expect(server.rows.size).toBe(0);

    server.offline = false;
    window.dispatchEvent(new Event('online')); // offline → online edge
    await vi.waitFor(() => expect(server.rows.get(id)?.data).toEqual({ text: 'offline edit' }));
    await vi.waitFor(() => expect(c.status.value).toBe('idle'));
  });
});

// ── Account hooks ────────────────────────────────────────────────────────────

describe('clearLocalRecords', () => {
  it('removes every local record and empties the lists', async () => {
    await setRecordUser(USER);
    const c = await notes();
    await c.put({ text: 'a' });
    await clearLocalRecords();
    expect(await listRecords()).toEqual([]);
    expect(c.items.value).toEqual([]);
  });
});

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { IndexedDbProjectStore, InMemoryProjectStore, type ProjectStore } from '~/utils/persistence/project-store';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import { uploadLocalProject, uploadLocalProjects } from './upload';
import { cloudMeta, fetchError, httpError, meta, mockClient, snapshot, type InvokeHandler } from './test-helpers';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** `create-project` answering like the edge function (initial snapshot at `seq`). */
function createOk(seq = 0): InvokeHandler {
  return (_name, body) => ({
    data: {
      id: body.id,
      name: body.name,
      description: body.description ?? null,
      created_at: 'c',
      updated_at: 'u',
      created: true,
      snapshot: body.snapshot ? { id: 'snap-1', sequence_number: seq, label: 'Uploaded', created_at: 'c' } : null,
    },
    error: null,
  });
}

let store: ProjectStore;
beforeEach(async () => {
  reportNetworkSuccess();
  store = new InMemoryProjectStore();
  await store.putProject(meta('p1', { name: 'Show', description: 'd' }));
  await store.putWorkingSnapshot('p1', snapshot('working'));
});

// ── uploadLocalProject ───────────────────────────────────────────────────────

describe('uploadLocalProject', () => {
  it('sends id, name and the working snapshot, then binds the copy to the account', async () => {
    const { client, invoke } = mockClient(createOk(4));
    const res = await uploadLocalProject(client, store, 'p1', 'u1');

    expect(invoke).toHaveBeenCalledWith('create-project', {
      body: { id: 'p1', name: 'Show', description: 'd', snapshot: snapshot('working') },
    });
    expect(res.ok).toBe(true);
    const after = await store.getProject('p1');
    expect(after).toMatchObject({ origin: 'cloud', ownerUserId: 'u1', role: 'owner', serverCursor: 4, remoteDeletedAt: null });
    expect(after!.lastSyncedAt).not.toBeNull();
    expect(await store.getBaseSnapshot('p1')).toEqual(snapshot('working'));
    expect(await store.countPending('p1')).toBe(0);
  });

  it('uploads a project without snapshot (cursor 0, no base)', async () => {
    await store.putProject(meta('empty'));
    const { client, invoke } = mockClient(createOk());
    const res = await uploadLocalProject(client, store, 'empty', 'u1');
    expect(res.ok).toBe(true);
    expect(invoke.mock.calls[0]![1]!.body).not.toHaveProperty('snapshot');
    expect((await store.getProject('empty'))!.serverCursor).toBe(0);
    expect(await store.getBaseSnapshot('empty')).toBeNull();
  });

  it('a network failure leaves the project local', async () => {
    const { client } = mockClient(() => ({ data: null, error: fetchError() }));
    const res = await uploadLocalProject(client, store, 'p1', 'u1');
    expect(!res.ok && res.error.kind).toBe('network');
    expect(await store.getProject('p1')).toMatchObject({ origin: 'local', ownerUserId: null });
    expect(await store.getBaseSnapshot('p1')).toBeNull();
  });

  it('refuses unknown, cloud and owner-bound projects without calling the server', async () => {
    await store.putProject(cloudMeta('c', 'u1'));
    await store.putProject(meta('bound', { ownerUserId: 'u2' }));
    const { client, invoke } = mockClient(createOk());
    expect(await uploadLocalProject(client, store, 'nope', 'u1')).toMatchObject({ ok: false, error: { kind: 'not-found' } });
    expect(await uploadLocalProject(client, store, 'c', 'u1')).toMatchObject({ ok: false, error: { kind: 'not-local' } });
    expect(await uploadLocalProject(client, store, 'bound', 'u1')).toMatchObject({ ok: false, error: { kind: 'not-local' } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('works with the IndexedDB store', async () => {
    const idb = new IndexedDbProjectStore({ factory: new IDBFactory() });
    await idb.putProject(meta('p1', { name: 'Show' }));
    await idb.putWorkingSnapshot('p1', snapshot('w'));
    const { client } = mockClient(createOk(2));
    expect((await uploadLocalProject(client, idb, 'p1', 'u1')).ok).toBe(true);
    expect(await idb.getProject('p1')).toMatchObject({ origin: 'cloud', ownerUserId: 'u1', serverCursor: 2 });
    expect(await idb.getBaseSnapshot('p1')).toEqual(snapshot('w'));
    idb.close();
  });
});

// ── uploadLocalProjects ──────────────────────────────────────────────────────

describe('uploadLocalProjects', () => {
  it('uploads sequentially and reports failures with readable messages', async () => {
    await store.putProject(meta('dup', { name: 'Dup' }));
    await store.putProject(meta('off', { name: 'Off' }));
    const ok = createOk(1);
    let inFlight = 0;
    const { client, invoke } = mockClient(async (name, body) => {
      inFlight++;
      expect(inFlight).toBe(1);
      await Promise.resolve();
      inFlight--;
      if (body.id === 'dup') return { data: null, error: httpError(409, 'exists') };
      if (body.id === 'off') return { data: null, error: new TypeError('Failed to fetch') };
      return ok(name, body);
    });

    const res = await uploadLocalProjects(client, store, ['p1', 'dup', 'off', 'missing'], 'u1');
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(res.uploaded.map(m => m.id)).toEqual(['p1']);
    expect(res.failed).toEqual([
      { id: 'dup', name: 'Dup', message: 'A project with this id already exists on the server' },
      { id: 'off', name: 'Off', message: 'You are offline' },
      { id: 'missing', name: 'missing', message: 'Project not found on this device' },
    ]);
    expect((await store.getProject('dup'))!.origin).toBe('local');
    expect((await store.getProject('off'))!.origin).toBe('local');
  });
});

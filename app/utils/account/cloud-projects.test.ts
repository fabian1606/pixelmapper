// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryProjectStore } from '~/utils/persistence/project-store';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import { createCloudProject, deleteCloudProject, renameCloudProject } from './cloud-projects';
import { cloudMeta, fetchError, httpError, mockClient, snapshot, type InvokeHandler } from './test-helpers';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** `create-project` echoing the requested id/name. */
const createOk: InvokeHandler = (_name, body) => ({
  data: { id: body.id, name: body.name, description: body.description ?? null, created: true, snapshot: null },
  error: null,
});

/** Always fails at the network level. */
const offline: InvokeHandler = () => ({ data: null, error: fetchError() });

let store: InMemoryProjectStore;
beforeEach(() => {
  reportNetworkSuccess();
  store = new InMemoryProjectStore();
});

// ── Create ───────────────────────────────────────────────────────────────────

describe('createCloudProject', () => {
  it('sends a client UUID and caches a bound copy when asked (desktop)', async () => {
    const { client, invoke } = mockClient(createOk);
    const res = await createCloudProject(client, store, { name: 'Show', description: 'd', userId: 'u1', cacheLocally: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const body = invoke.mock.calls[0]![1]!.body!;
    expect(body).toMatchObject({ id: res.data.id, name: 'Show', description: 'd' });
    expect(res.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await store.getProject(res.data.id)).toMatchObject({
      name: 'Show', description: 'd', origin: 'cloud', ownerUserId: 'u1', role: 'owner', serverCursor: 0,
    });
  });

  it('does not touch the store without cacheLocally (web)', async () => {
    const { client } = mockClient(createOk);
    const res = await createCloudProject(client, store, { name: 'Show', userId: 'u1', cacheLocally: false });
    expect(res.ok).toBe(true);
    expect(await store.listProjects()).toEqual([]);
  });

  it('a failure leaves the store untouched', async () => {
    const { client } = mockClient(offline);
    const res = await createCloudProject(client, store, { name: 'Show', userId: 'u1', cacheLocally: true });
    expect(!res.ok && res.error.kind).toBe('network');
    expect(await store.listProjects()).toEqual([]);
  });
});

// ── Rename ───────────────────────────────────────────────────────────────────

describe('renameCloudProject', () => {
  it('renames on the server, then the local copy', async () => {
    await store.putProject(cloudMeta('p', 'u1', { name: 'Old', description: 'old' }));
    const { client, invoke } = mockClient(() => ({ data: { ok: true }, error: null }));
    const res = await renameCloudProject(client, store, 'p', 'New', '');
    expect(res.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith('rename-project', { body: { projectId: 'p', name: 'New', description: undefined } });
    const after = await store.getProject('p');
    expect(after!.name).toBe('New');
    expect(after!.description).toBeUndefined();
  });

  it('succeeds without a local copy (web, not opened)', async () => {
    const { client } = mockClient(() => ({ data: { ok: true }, error: null }));
    expect((await renameCloudProject(client, store, 'p', 'New')).ok).toBe(true);
    expect(await store.getProject('p')).toBeNull();
  });

  it('a failure keeps the local name', async () => {
    await store.putProject(cloudMeta('p', 'u1', { name: 'Old' }));
    const { client } = mockClient(() => ({ data: null, error: httpError(403, 'not owner') }));
    const res = await renameCloudProject(client, store, 'p', 'New');
    expect(res).toMatchObject({ ok: false, error: { kind: 'forbidden', message: 'not owner' } });
    expect((await store.getProject('p'))!.name).toBe('Old');
  });
});

// ── Delete ───────────────────────────────────────────────────────────────────

describe('deleteCloudProject', () => {
  it('deletes on the server, then the local copy', async () => {
    await store.putProject(cloudMeta('p', 'u1'));
    await store.putWorkingSnapshot('p', snapshot());
    const { client, invoke } = mockClient(() => ({ data: null, error: null }));
    expect((await deleteCloudProject(client, store, 'p')).ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith('delete-project', { body: { projectId: 'p' } });
    expect(await store.getProject('p')).toBeNull();
    expect(await store.getWorkingSnapshot('p')).toBeNull();
  });

  it('a failure keeps the local copy', async () => {
    await store.putProject(cloudMeta('p', 'u1'));
    const { client } = mockClient(offline);
    expect((await deleteCloudProject(client, store, 'p')).ok).toBe(false);
    expect(await store.getProject('p')).not.toBeNull();
  });
});

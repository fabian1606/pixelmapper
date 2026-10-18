// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryProjectStore } from '~/utils/persistence/project-store';
import {
  createLocalProject,
  deleteLocalProject,
  detachAsLocalCopy,
  listBoundCloudProjects,
  listUploadCandidates,
  renameLocalProject,
} from './local-projects';
import { cloudMeta, meta, outboxEntry, snapshot } from './test-helpers';

let store: InMemoryProjectStore;
beforeEach(() => { store = new InMemoryProjectStore(); });

// ── Create / rename / delete ─────────────────────────────────────────────────

describe('createLocalProject', () => {
  it('creates a local-only project with a UUID and the snapshot as working snapshot', async () => {
    const snap = snapshot('import');
    const m = await createLocalProject(store, { name: '  Show  ', description: 'd', snapshot: snap });
    expect(m.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(m).toMatchObject({ name: 'Show', description: 'd', origin: 'local', ownerUserId: null, serverCursor: 0, lastSyncedAt: null });
    expect(await store.getProject(m.id)).toEqual(m);
    expect(await store.getWorkingSnapshot(m.id)).toEqual(snap);
    expect(await store.getBaseSnapshot(m.id)).toBeNull();
    expect(await store.countPending(m.id)).toBe(0);
  });

  it('defaults a blank name and creates without a snapshot', async () => {
    const m = await createLocalProject(store, { name: ' ' });
    expect(m.name).toBe('Untitled project');
    expect(await store.getWorkingSnapshot(m.id)).toBeNull();
  });
});

describe('renameLocalProject / deleteLocalProject', () => {
  it('renames, keeps the name when blank, clears the description with ""', async () => {
    await store.putProject(meta('a', { description: 'old' }));
    expect(await renameLocalProject(store, 'a', 'New', 'desc')).toBe(true);
    expect(await store.getProject('a')).toMatchObject({ name: 'New', description: 'desc' });
    await renameLocalProject(store, 'a', '  ', '');
    const after = await store.getProject('a');
    expect(after!.name).toBe('New');
    expect(after!.description).toBeUndefined();
  });

  it('leaves the description untouched when not given; unknown ids return false', async () => {
    await store.putProject(meta('a', { description: 'keep' }));
    await renameLocalProject(store, 'a', 'B');
    expect((await store.getProject('a'))!.description).toBe('keep');
    expect(await renameLocalProject(store, 'nope', 'x')).toBe(false);
  });

  it('deletes meta, snapshots and outbox', async () => {
    await store.putProject(cloudMeta('a', 'u1'));
    await store.putWorkingSnapshot('a', snapshot());
    await store.appendOutbox(outboxEntry('a'));
    await deleteLocalProject(store, 'a');
    expect(await store.getProject('a')).toBeNull();
    expect(await store.getWorkingSnapshot('a')).toBeNull();
    expect(await store.countPending('a')).toBe(0);
  });
});

// ── Detach ───────────────────────────────────────────────────────────────────

describe('detachAsLocalCopy', () => {
  it('copies the working snapshot into a new local project without outbox', async () => {
    await store.putProject(cloudMeta('src', 'u1', { name: 'Show', description: 'd', serverCursor: 7 }));
    await store.putBaseSnapshot('src', snapshot('base'), 7);
    await store.putWorkingSnapshot('src', snapshot('working'));
    await store.appendOutbox(outboxEntry('src'));

    const copy = await detachAsLocalCopy(store, 'src');
    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe('src');
    expect(copy).toMatchObject({ name: 'Show (local copy)', description: 'd', origin: 'local', ownerUserId: null, serverCursor: 0 });
    expect(await store.getWorkingSnapshot(copy!.id)).toEqual(snapshot('working'));
    expect(await store.countPending(copy!.id)).toBe(0);
    // Source untouched.
    expect(await store.countPending('src')).toBe(1);
    expect((await store.getProject('src'))!.origin).toBe('cloud');
  });

  it('falls back to the base snapshot; unknown source → null', async () => {
    await store.putProject(cloudMeta('src', 'u1'));
    await store.putBaseSnapshot('src', snapshot('base'), 3);
    const copy = await detachAsLocalCopy(store, 'src');
    expect(await store.getWorkingSnapshot(copy!.id)).toEqual(snapshot('base'));
    expect(await detachAsLocalCopy(store, 'missing')).toBeNull();
  });
});

// ── Queries ──────────────────────────────────────────────────────────────────

describe('queries', () => {
  beforeEach(async () => {
    await store.putProject(meta('old', { updatedAt: 1 }));
    await store.putProject(meta('new', { updatedAt: 2 }));
    await store.putProject(meta('bound', { ownerUserId: 'u1' }));
    await store.putProject(cloudMeta('c1', 'u1'));
    await store.putProject(cloudMeta('c2', 'u2'));
  });

  it('upload candidates: local and unbound only, newest first', async () => {
    expect((await listUploadCandidates(store)).map(m => m.id)).toEqual(['new', 'old']);
  });

  it('bound cloud projects of one account', async () => {
    expect((await listBoundCloudProjects(store, 'u1')).map(m => m.id)).toEqual(['c1']);
    expect(await listBoundCloudProjects(store, 'u3')).toEqual([]);
  });
});

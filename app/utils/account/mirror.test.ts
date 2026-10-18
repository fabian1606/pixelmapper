// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryProjectStore } from '~/utils/persistence/project-store';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import { reconcileRemoteHeads, runMirrorPass } from './mirror';
import { cloudMeta, fakeSync, fetchError, head, headRow, meta, mockClient, outboxEntry } from './test-helpers';
import type { RemoteProjectHead } from '~/utils/sync/remote-api-types';

/** Request start after every fixture's createdAt (1000). */
const OPTS = { requestStartedAt: 5000, now: 6000 };

let store: InMemoryProjectStore;
beforeEach(() => {
  reportNetworkSuccess();
  store = new InMemoryProjectStore();
});

// ── reconcileRemoteHeads ─────────────────────────────────────────────────────

describe('reconcileRemoteHeads', () => {
  it('refreshes name, description and role from the head', async () => {
    await store.putProject(cloudMeta('p', 'u1', { name: 'Old', description: 'old', role: 'owner', remoteDeletedAt: 3 }));
    await reconcileRemoteHeads(store, [head('p', { name: 'New', description: null, role: 'editor' })], 'u1', OPTS);
    const after = await store.getProject('p');
    expect(after).toMatchObject({ name: 'New', role: 'editor', remoteDeletedAt: null });
    expect(after!.description).toBeUndefined();
  });

  it('removes a copy that vanished from the list when nothing is pending', async () => {
    await store.putProject(cloudMeta('gone', 'u1'));
    const res = await reconcileRemoteHeads(store, [], 'u1', OPTS);
    expect(res.removed).toEqual(['gone']);
    expect(await store.getProject('gone')).toBeNull();
  });

  it('keeps a vanished copy with pending changes and marks it once', async () => {
    await store.putProject(cloudMeta('gone', 'u1'));
    await store.appendOutbox(outboxEntry('gone'));
    const first = await reconcileRemoteHeads(store, [], 'u1', OPTS);
    expect(first.markedDeleted.map(m => m.id)).toEqual(['gone']);
    expect((await store.getProject('gone'))!.remoteDeletedAt).toBe(6000);

    const second = await reconcileRemoteHeads(store, [], 'u1', { ...OPTS, now: 9000 });
    expect(second.markedDeleted).toEqual([]);
    expect((await store.getProject('gone'))!.remoteDeletedAt).toBe(6000);
    expect(await store.countPending('gone')).toBe(1);
  });

  it('leaves copies created after the request started alone', async () => {
    await store.putProject(cloudMeta('fresh', 'u1', { createdAt: 5000 }));
    const res = await reconcileRemoteHeads(store, [], 'u1', OPTS);
    expect(res.removed).toEqual([]);
    expect(await store.getProject('fresh')).not.toBeNull();
  });

  it('never touches other accounts or local-only projects', async () => {
    const other = cloudMeta('other', 'u2', { name: 'Theirs' });
    const local = meta('local');
    await store.putProject(other);
    await store.putProject(local);
    const res = await reconcileRemoteHeads(store, [head('other', { name: 'Renamed', latestSequence: 50 })], 'u1', OPTS);
    expect(await store.getProject('other')).toEqual(other);
    expect(await store.getProject('local')).toEqual(local);
    expect(res).toEqual({ stale: [], removed: [], markedDeleted: [] });
  });

  it('stale = missing locally or behind the server cursor', async () => {
    await store.putProject(cloudMeta('behind', 'u1', { serverCursor: 3 }));
    await store.putProject(cloudMeta('current', 'u1', { serverCursor: 5 }));
    const heads = [
      head('behind', { latestSequence: 4 }),
      head('current', { latestSequence: 5 }),
      head('missing', { latestSequence: 0 }),
    ];
    const res = await reconcileRemoteHeads(store, heads, 'u1', OPTS);
    expect(res.stale.map(h => h.id)).toEqual(['behind', 'missing']);
  });
});

// ── runMirrorPass ────────────────────────────────────────────────────────────

/** Client whose `list-projects-sync` returns `heads`. */
function listing(heads: RemoteProjectHead[]) {
  return mockClient(() => ({ data: { projects: heads.map(headRow) }, error: null }));
}

describe('runMirrorPass', () => {
  it('mirrors only stale heads, sequentially, and counts failures', async () => {
    await store.putProject(cloudMeta('current', 'u1', { serverCursor: 2 }));
    const { client } = listing([head('a', { latestSequence: 1 }), head('current', { latestSequence: 2 }), head('b')]);
    let inFlight = 0;
    const sync = fakeSync({
      mirrorProject: async (h) => {
        inFlight++;
        expect(inFlight).toBe(1);
        await Promise.resolve();
        inFlight--;
        return h.id !== 'b';
      },
    });
    const res = await runMirrorPass({ client, store, sync, userId: 'u1' });
    expect(res).toMatchObject({ ok: true, mirrored: 1, failed: 1 });
    if (!res.ok) return;
    expect(res.reconcile.stale.map(h => h.id)).toEqual(['a', 'b']);
  });

  it('passes the head and account to mirrorProject', async () => {
    const h = head('a', { latestSequence: 3 });
    const { client } = listing([h]);
    const sync = fakeSync();
    await runMirrorPass({ client, store, sync, userId: 'u1' });
    expect(sync.mirrorProject).toHaveBeenCalledWith(h, 'u1');
  });

  it('stops between projects when cancelled', async () => {
    const { client } = listing([head('a'), head('b'), head('c')]);
    let cancelled = false;
    const sync = fakeSync({ mirrorProject: async () => { cancelled = true; return true; } });
    const res = await runMirrorPass({ client, store, sync, userId: 'u1', isCancelled: () => cancelled });
    expect(res).toMatchObject({ ok: true, mirrored: 1, failed: 0 });
  });

  it('does not reconcile when cancelled before the list arrives', async () => {
    await store.putProject(cloudMeta('gone', 'u1'));
    const { client } = listing([]);
    const sync = fakeSync();
    await runMirrorPass({ client, store, sync, userId: 'u1', isCancelled: () => true });
    expect(await store.getProject('gone')).not.toBeNull();
  });

  it('returns ok:false when the list cannot be fetched and touches nothing', async () => {
    await store.putProject(cloudMeta('p', 'u1'));
    const { client } = mockClient(() => ({ data: null, error: fetchError() }));
    const sync = fakeSync();
    const res = await runMirrorPass({ client, store, sync, userId: 'u1' });
    expect(res).toMatchObject({ ok: false, error: { kind: 'network' } });
    expect(sync.mirrorProject).not.toHaveBeenCalled();
    expect(await store.getProject('p')).not.toBeNull();
  });
});

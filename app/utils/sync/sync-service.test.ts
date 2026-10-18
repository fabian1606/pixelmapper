import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryProjectStore } from '~/utils/persistence/project-store';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import { setOpenSyncEngine } from '~/utils/sync/open-sync-engine';
import { createProjectSyncService } from '~/utils/sync/project-sync-service-impl';
import type { ProjectSyncService } from '~/utils/sync/project-sync-service';
import type { RemoteProjectHead } from '~/utils/sync/remote-api';
import { packSnapshot, SyncPosition } from '~/utils/sync/sync-position';
import { makeState, mod } from '~/utils/sync/merge/adapters/test-state';
import { SyncEngine } from '~/utils/sync/sync-engine';
import { appendRow, cloudMeta, FakePort, makeDeps, readBase, readWorking, seedBase } from '~/utils/sync/sync-test-kit';
import { FakeSyncServer } from '~/utils/sync/sync-test-server';

/** Headless mirror and logout flush of closed projects (ADR 0004 D13, D15, D16). */

let server: FakeSyncServer;
let store: InMemoryProjectStore;
let service: ProjectSyncService;

/** Project head as `list-projects-sync` returns it. */
function head(id: string, latestSequence: number, latestSnapshotSequence: number): RemoteProjectHead {
  return {
    id,
    name: `Server ${id}`,
    description: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    role: 'owner',
    ownerId: 'u-me',
    latestSequence,
    latestChangeAt: null,
    latestSnapshotSequence,
  };
}

/** Closed cloud project with a base at seq 0 and one pending row. */
async function closedWithPending(id: string, metaOver = {}): Promise<void> {
  await store.putProject(cloudMeta(id, metaOver));
  await seedBase(store, id, makeState(), SyncPosition.at(0));
  await store.putWorkingSnapshot(id, packSnapshot(makeState({ globalBpm: 77 }), SyncPosition.at(0), 1));
  await appendRow(store, id, `${id}-row`, 'engine.bpm', { bpm: 77 }, 'live-op');
}

beforeEach(() => {
  reportNetworkSuccess();
  setOpenSyncEngine(null);
  server = new FakeSyncServer();
  store = new InMemoryProjectStore();
  service = createProjectSyncService({ client: server.client, store: async () => store });
});

// ── Mirror ───────────────────────────────────────────────────────────────────

describe('mirrorProject', () => {
  it('stores the server snapshot of an unknown project as base + working copy', async () => {
    for (let i = 0; i < 3; i++) server.insert('m1', 'engine.bpm', { bpm: i });
    server.addSnapshot('m1', makeState({ modifiers: [mod('A')] }), 3);

    await expect(service.mirrorProject(head('m1', 3, 3), 'u-me')).resolves.toBe(true);

    expect(await store.getProject('m1')).toMatchObject({ origin: 'cloud', ownerUserId: 'u-me', serverCursor: 3, name: 'Server m1' });
    const base = await readBase(store, 'm1');
    const working = await readWorking(store, 'm1');
    expect(base?.snapshot.modifiers).toEqual([mod('A')]);
    expect(base?.position.cursor).toBe(3);
    expect(working?.snapshot.modifiers).toEqual([mod('A')]);
  });

  it('leaves projects with pending rows alone (only meta is refreshed)', async () => {
    await closedWithPending('m2');
    server.addSnapshot('m2', makeState({ modifiers: [mod('Z')] }), 5);

    await expect(service.mirrorProject(head('m2', 5, 5), 'u-me')).resolves.toBe(true);

    expect(server.callNames()).not.toContain('load-project');
    expect((await readBase(store, 'm2'))?.snapshot.modifiers).toEqual([]);
    expect((await store.getProject('m2'))?.name).toBe('Server m2');
    expect((await store.getOutbox('m2')).map(r => r.id)).toEqual(['m2-row']);
  });
});

describe('mirrorProject of the open project', () => {
  it('delegates to its engine: no headless load, concurrent requests apply each change once', async () => {
    await store.putProject(cloudMeta('open'));
    await seedBase(store, 'open', makeState(), SyncPosition.at(0));
    const port = new FakePort(makeState());
    const engine = new SyncEngine(makeDeps(server, store, port, 'open'), {
      base: { snapshot: makeState(), position: SyncPosition.at(0) }, live: SyncPosition.at(0), backlog: false,
    });
    setOpenSyncEngine(engine);
    server.insert('open', 'engine.bpm', { bpm: 101 });
    server.insert('open', 'engine.bpm', { bpm: 102 });
    server.addSnapshot('open', makeState({ globalBpm: 102 }), 2);

    const results = await Promise.all([
      service.mirrorProject(head('open', 2, 2), 'u-me'),
      service.mirrorProject(head('open', 2, 2), 'u-me'),
      engine.requestSync(),
    ]);

    expect(results.slice(0, 2)).toEqual([true, true]);
    expect(server.callNames()).not.toContain('load-project');
    expect(port.replaysOf('engine.bpm').map(r => (r.payload as { bpm: number }).bpm)).toEqual([101, 102]);
    // Bound to another account: the engine is not asked to sync.
    const before = server.calls.length;
    await expect(service.mirrorProject(head('open', 2, 2), 'u-other')).resolves.toBe(true);
    expect(server.calls.length).toBe(before);
    engine.stop();
    setOpenSyncEngine(null);
  });

  it('a closed copy bound to another account is left untouched', async () => {
    await store.putProject(cloudMeta('theirs', { ownerUserId: 'u-other' }));
    server.addSnapshot('theirs', makeState({ globalBpm: 9 }), 4);

    await expect(service.mirrorProject(head('theirs', 4, 4), 'u-me')).resolves.toBe(true);

    expect(server.calls).toEqual([]);
    expect(await store.getBaseSnapshot('theirs')).toBeNull();
    expect((await store.getProject('theirs'))?.ownerUserId).toBe('u-other');
  });
});

// ── Flush ────────────────────────────────────────────────────────────────────

describe('flushAll', () => {
  it('pushes only own, not deleted projects without foreign changes since the base', async () => {
    await closedWithPending('own');
    await closedWithPending('deleted', { remoteDeletedAt: 10 });
    await closedWithPending('foreign-account', { ownerUserId: 'u-other' });
    await closedWithPending('diverged');
    server.insert('diverged', 'engine.bpm', { bpm: 1 });

    const remaining = await service.flushAll('u-me');

    const pushed = server.calls.filter(c => c.name === 'push-change').map(c => c.body.projectId);
    expect(pushed).toEqual(['own']);
    expect(server.rowsOf('own').map(r => r.change_id)).toEqual(['own-row']);
    expect(await store.getOutbox('own')).toEqual([]);
    // The acked change is recorded in the working position (not re-applied on open).
    const working = await readWorking(store, 'own');
    const row = server.rowsOf('own')[0]!;
    expect(working?.position.reflects(row.change_id, row.sequence_number)).toBe(true);
    // Never pushed: deleted, other account, needs a rebase.
    for (const id of ['deleted', 'foreign-account', 'diverged']) {
      expect((await store.getOutbox(id)).map(r => r.id)).toEqual([`${id}-row`]);
    }
    expect(server.calls.some(c => c.body.projectId === 'foreign-account')).toBe(false);
    // Still pending for this account: deleted + diverged (other account excluded).
    expect(remaining).toBe(2);
  });
});

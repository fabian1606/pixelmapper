import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryProjectStore } from '~/utils/persistence/project-store';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import { openFromLocal, openFromServer, type OpenFlowHost } from '~/utils/sync/open-flow';
import { readLocalProject } from '~/utils/sync/open-project';
import { packSnapshot, SyncPosition } from '~/utils/sync/sync-position';
import { makeState, mod } from '~/utils/sync/merge/adapters/test-state';
import { appendRow, cloudMeta, FakePort, readBase, readWorking } from '~/utils/sync/sync-test-kit';
import { FakeSyncServer } from '~/utils/sync/sync-test-server';

/** Local-first open and first-open download (ADR 0004 D1, §3.1). */

const PID = 'p-open';

let server: FakeSyncServer;
let store: InMemoryProjectStore;
let port: FakePort;
let host: OpenFlowHost;

beforeEach(() => {
  reportNetworkSuccess();
  server = new FakeSyncServer();
  store = new InMemoryProjectStore();
  port = new FakePort(makeState());
  host = { port, reset: vi.fn(async () => {}), gate: () => true };
});

// ── Local copy ───────────────────────────────────────────────────────────────

describe('openFromLocal', () => {
  it('opens offline from the working snapshot and replays only rows above its outboxOrder', async () => {
    server.offline = true;
    const base = makeState({ modifiers: [mod('A')], globalBpm: 90 });
    const position = new SyncPosition({ floor: 3, cursor: 5, seen: [{ id: 'srv-5', seq: 5 }] });
    await store.putProject(cloudMeta(PID, { serverCursor: 3 }));
    await store.putBaseSnapshot(PID, packSnapshot(base, SyncPosition.at(3)), 3);
    const r1 = await appendRow(store, PID, 'r1', 'engine.bpm', { bpm: 100 }, 'live-op');
    const r2 = await appendRow(store, PID, 'r2', 'engine.bpm', { bpm: 110 }, 'live-op');
    const r3 = await appendRow(store, PID, 'r3', 'engine.bpm', { bpm: 120 }, 'live-op');
    // The working snapshot reflects r1 and r2 (outboxOrder = r2.order).
    await store.putWorkingSnapshot(PID, packSnapshot({ ...base, globalBpm: 110 }, position, r2.order));

    const local = await readLocalProject(store, PID);
    const res = await openFromLocal(host, local, await store.getProject(PID));

    expect(server.client.functions.invoke).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Exactly r3 replayed, once.
    expect(port.replayed).toEqual([{ type: 'engine.bpm', payload: { bpm: 120 } }]);
    expect(port.state.globalBpm).toBe(120);
    expect(r1.order).toBeLessThan(r2.order);
    expect(res.project.outboxOrder).toBe(r3.order);
    expect(res.project.backlog).toBe(true);
    expect(res.project.position.toData()).toEqual(position.toData());
    // The base for rebasing is the stored base, not the working copy.
    expect(res.project.base?.snapshot.globalBpm).toBe(90);
    expect(res.project.base?.position.cursor).toBe(3);
  });
});

// ── First open ───────────────────────────────────────────────────────────────

describe('openFromServer', () => {
  it('offline → offline-unavailable, nothing stored', async () => {
    server.offline = true;
    const res = await openFromServer(host, { store, client: server.client, projectId: PID, userId: 'u-me', meta: null });

    expect(res).toEqual({ ok: false, error: 'offline-unavailable' });
    expect(host.reset).not.toHaveBeenCalled();
    expect(await store.listProjects()).toEqual([]);
    expect(await store.getBaseSnapshot(PID)).toBeNull();
    expect(await store.getWorkingSnapshot(PID)).toBeNull();
  });

  it('online: snapshot + truncated tail continued via pull-changes; cursor = last sequence', async () => {
    for (let i = 1; i <= 5; i++) server.insert(PID, 'engine.bpm', { bpm: i });
    server.addSnapshot(PID, makeState({ globalBpm: 5 }), 5);
    for (let i = 6; i <= 9; i++) server.insert(PID, 'engine.bpm', { bpm: i * 10 });
    server.tailCap = 2;

    const res = await openFromServer(host, { store, client: server.client, projectId: PID, userId: 'u-me', meta: null });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(server.callNames()).toEqual(['load-project', 'pull-changes']);
    expect(server.calls[1]!.body.afterSequence).toBe(7);
    // Every tail row replayed exactly once, in order.
    expect(port.replaysOf('engine.bpm').map(r => (r.payload as { bpm: number }).bpm)).toEqual([60, 70, 80, 90]);
    expect(port.state.globalBpm).toBe(90);

    const meta = await store.getProject(PID);
    expect(meta).toMatchObject({ origin: 'cloud', ownerUserId: 'u-me', serverCursor: 9 });
    const base = await readBase(store, PID);
    expect(base?.position.cursor).toBe(9);
    expect(base?.snapshot.globalBpm).toBe(90);
    expect(res.project.backlog).toBe(false);
  });

  it('regression: empty tail → cursor from snapshotSequence (not snapshot.sequence_number)', async () => {
    for (let i = 1; i <= 4; i++) server.insert(PID, 'engine.bpm', { bpm: i });
    server.addSnapshot(PID, makeState({ globalBpm: 4 }), 4);

    const res = await openFromServer(host, { store, client: server.client, projectId: PID, userId: 'u-me', meta: null });

    expect(res.ok).toBe(true);
    expect(server.callNames()).toEqual(['load-project']);
    expect((await store.getProject(PID))?.serverCursor).toBe(4);
    expect((await readBase(store, PID))?.position.cursor).toBe(4);
    expect((await readWorking(store, PID))?.position.cursor).toBe(4);
  });

  it('acks outbox rows the server has and replays the others on top', async () => {
    server.addSnapshot(PID, makeState({ globalBpm: 1 }), 0);
    server.insert(PID, 'engine.bpm', { bpm: 2 }, { changeId: 'mine-1', userId: 'u-me' });
    await appendRow(store, PID, 'mine-1', 'engine.bpm', { bpm: 2 }, 'live-op');
    await appendRow(store, PID, 'mine-2', 'engine.bpm', { bpm: 3 }, 'live-op');

    const res = await openFromServer(host, { store, client: server.client, projectId: PID, userId: 'u-me', meta: null });

    expect(res.ok && res.project.backlog).toBe(true);
    expect((await store.getOutbox(PID)).map(r => r.id)).toEqual(['mine-2']);
    expect(port.state.globalBpm).toBe(3);
    // Base = server state only; working = base + pending.
    expect((await readBase(store, PID))?.snapshot.globalBpm).toBe(2);
    expect((await readWorking(store, PID))?.snapshot.globalBpm).toBe(3);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryProjectStore, type LocalProjectMeta } from '~/utils/persistence/project-store';
import { flushOutboxWrites, setOutboxStoreForTests } from '~/utils/persistence/outbox-writer';
import {
  clearPersistQueue,
  enqueueLiveOp,
  flushPersistQueue,
  setPersistHook,
  setPersistProjectId,
} from '~/utils/persistence/persist-queue';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import { openFromLocal, type OpenedProject } from '~/utils/sync/open-flow';
import { readLocalProject } from '~/utils/sync/open-project';
import { getOpenSyncEngine } from '~/utils/sync/open-sync-engine';
import { startProjectSession, syncBlocker, type ProjectSession } from '~/utils/sync/project-session';
import { syncStatus } from '~/utils/sync/project-sync-service';
import { SyncPosition } from '~/utils/sync/sync-position';
import { makeState } from '~/utils/sync/merge/adapters/test-state';
import { appendRow, cloudMeta, FakePort, readWorking } from '~/utils/sync/sync-test-kit';
import { FakeSyncServer } from '~/utils/sync/sync-test-server';

/** Projects that never sync: local-only, signed out, other account (ADR 0004 D3, D14, D15). */

const PID = 'p-session';

let server: FakeSyncServer;
let store: InMemoryProjectStore;
let port: FakePort;
let session: ProjectSession | null = null;

/** Start a session for `meta` as `userId`. */
function start(meta: LocalProjectMeta, userId: string | null): ProjectSession {
  const opened: OpenedProject = { meta, position: SyncPosition.at(0), base: null, outboxOrder: 0, backlog: false };
  session = startProjectSession({
    projectId: PID,
    store,
    client: server.client,
    port,
    userId,
    opened,
    hasQueuedEntries: () => false,
    onLiveChanged: vi.fn(),
    onSequence: vi.fn(),
    discardSession: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
  });
  return session;
}

/** Let fire-and-forget status updates settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>(r => setTimeout(r, 0));
}

beforeEach(() => {
  reportNetworkSuccess();
  server = new FakeSyncServer();
  store = new InMemoryProjectStore();
  setOutboxStoreForTests(store);
  port = new FakePort(makeState({ globalBpm: 128 }));
});

afterEach(async () => {
  await session?.close(true);
  session = null;
  clearPersistQueue();
  setPersistHook(null);
  setPersistProjectId(null);
  await flushOutboxWrites();
  setOutboxStoreForTests(null);
});

// ── Local-only ───────────────────────────────────────────────────────────────

describe('local-only project', () => {
  it('no engine, no network, working snapshot written, no outbox rows', async () => {
    const meta: LocalProjectMeta = { ...cloudMeta(PID), origin: 'local', ownerUserId: null };
    await store.putProject(meta);
    const s = start(meta, 'u-me');

    expect(s.origin).toBe('local');
    expect(s.engine).toBeNull();
    expect(getOpenSyncEngine(PID)).toBeNull();
    expect(syncStatus.value.state).toBe('local-only');
    await expect(s.pushHook([{ type: 'engine.bpm', payload: { bpm: 1 }, changeId: 'x' }])).resolves.toEqual([undefined]);
    expect(await s.canSaveServerSnapshot()).toBe(false);

    // Persist path without outbox (D14).
    setPersistProjectId(PID, { outbox: false });
    setPersistHook(s.pushHook);
    enqueueLiveOp('engine.bpm', { bpm: 140 }, 'engine.bpm');
    await flushPersistQueue();
    await flushOutboxWrites();
    expect(await store.getOutbox(PID)).toEqual([]);

    // The working snapshot is the only persistence.
    port.state.globalBpm = 140;
    await s.writer.flush();
    expect((await readWorking(store, PID))?.snapshot.globalBpm).toBe(140);
    await settle();
    expect(server.client.functions.invoke).not.toHaveBeenCalled();
    expect(syncStatus.value.state).toBe('local-only');
  });
  it('closing writes the working snapshot; reopening yields the identical state without network', async () => {
    const meta: LocalProjectMeta = { ...cloudMeta(PID), origin: 'local', ownerUserId: null };
    await store.putProject(meta);
    const s = start(meta, 'u-me');
    port.state.globalBpm = 133;
    port.state.modifiers = [{ id: 'M', plugin: 'p', strength: 1, params: { speed: 2 } } as never];
    const closedState = port.capture();
    await s.close();
    session = null;

    const next = new FakePort(makeState());
    const res = await openFromLocal({ port: next, reset: vi.fn(async () => {}), gate: () => true }, await readLocalProject(store, PID), meta);

    expect(res.ok).toBe(true);
    expect(next.state).toEqual(closedState);
    expect(next.replayed).toEqual([]);
    expect(await store.getOutbox(PID)).toEqual([]);
    expect(server.client.functions.invoke).not.toHaveBeenCalled();
  });
});

// ── Unbound cloud copies ─────────────────────────────────────────────────────

describe('syncBlocker', () => {
  it('blocks signed-out, other-account and remotely deleted copies', () => {
    expect(syncBlocker(cloudMeta(PID), null)).toMatch(/sign in/i);
    expect(syncBlocker(cloudMeta(PID, { ownerUserId: 'u-other' }), 'u-me')).toMatch(/another account/i);
    expect(syncBlocker(cloudMeta(PID, { remoteDeletedAt: 5 }), 'u-me')).toMatch(/deleted/i);
    expect(syncBlocker(cloudMeta(PID), 'u-me')).toBeNull();
    // Not bound yet (first open of a copy): may sync as the signed-in user.
    expect(syncBlocker(cloudMeta(PID, { ownerUserId: null }), 'u-me')).toBeNull();
  });
});

describe('unbound cloud copy', () => {
  it.each([
    ['signed out', null, cloudMeta(PID)],
    ['other account', 'u-me', cloudMeta(PID, { ownerUserId: 'u-other' })],
    ['deleted on the server', 'u-me', cloudMeta(PID, { remoteDeletedAt: 5 })],
  ] as const)('%s: no engine, nothing pushed, outbox rows kept', async (_label, userId, meta) => {
    await store.putProject(meta);
    await appendRow(store, PID, 'pending-1', 'engine.bpm', { bpm: 99 }, 'live-op');
    const s = start(meta, userId);

    expect(s.origin).toBe('cloud');
    expect(s.engine).toBeNull();
    expect(getOpenSyncEngine(PID)).toBeNull();
    await expect(s.pushHook([{ type: 'engine.bpm', payload: { bpm: 99 }, changeId: 'pending-1' }])).resolves.toEqual([undefined]);
    await settle();

    expect(server.client.functions.invoke).not.toHaveBeenCalled();
    expect((await store.getOutbox(PID)).map(r => r.id)).toEqual(['pending-1']);
    expect(syncStatus.value).toMatchObject({ state: 'offline', pending: 1 });
    expect(syncStatus.value.error).toBe(syncBlocker(meta, userId));
  });
});

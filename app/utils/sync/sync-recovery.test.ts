import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexedDbProjectStore } from '~/utils/persistence/project-store';
import { flushOutboxWrites, queueOutboxRow, setOutboxStoreForTests } from '~/utils/persistence/outbox-writer';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import { openFromLocal, openFromServer, type OpenedProject } from '~/utils/sync/open-flow';
import { readLocalProject } from '~/utils/sync/open-project';
import { SyncEngine } from '~/utils/sync/sync-engine';
import { packSnapshot } from '~/utils/sync/sync-position';
import { createWorkingSnapshotWriter } from '~/utils/sync/working-snapshot-writer';
import { makeState, mod } from '~/utils/sync/merge/adapters/test-state';
import { FakePort, makeDeps, setModifiers } from '~/utils/sync/sync-test-kit';
import { FakeSyncServer } from '~/utils/sync/sync-test-server';

/**
 * Crash recovery against a real IndexedDB store (fake-indexeddb, ADR 0004
 * D1, D8): outbox rows survive a "restart" (new store + engine instances),
 * the project reopens offline with the edits, and the later sync pushes
 * every row exactly once (idempotent by change id).
 */

const PID = 'p-crash';
const A = mod('A', { speed: 1 });

let factory: IDBFactory;
let server: FakeSyncServer;
let engine: SyncEngine | null;

beforeEach(() => {
  reportNetworkSuccess();
  factory = new IDBFactory();
  server = new FakeSyncServer();
  engine = null;
});

afterEach(async () => {
  engine?.stop();
  await flushOutboxWrites();
  setOutboxStoreForTests(null);
  reportNetworkSuccess();
});

/** A fresh store instance on the same database (page reload). */
function reopenStore(previous?: IndexedDbProjectStore): IndexedDbProjectStore {
  previous?.close();
  return new IndexedDbProjectStore({ factory });
}

/** Open from the local copy into a fresh port (offline-capable). */
async function openLocal(store: IndexedDbProjectStore): Promise<{ port: FakePort; opened: OpenedProject }> {
  const port = new FakePort(makeState());
  const host = { port, reset: vi.fn(async () => {}), gate: () => true };
  const res = await openFromLocal(host, await readLocalProject(store, PID), await store.getProject(PID));
  if (!res.ok) throw new Error(`open failed: ${res.error}`);
  return { port, opened: res.project };
}

/** Engine of a reopened session (like `startProjectSession`). */
function startEngine(store: IndexedDbProjectStore, port: FakePort, opened: OpenedProject): SyncEngine {
  // The real working snapshot writer: the engine's checkpoints must land in it.
  const writer = createWorkingSnapshotWriter({
    projectId: PID,
    store,
    capture: () => port.capture(),
    position: () => engine?.livePosition() ?? opened.position,
    outboxOrder: () => opened.outboxOrder,
    outbox: null,
  });
  engine = new SyncEngine(makeDeps(server, store, port, PID, { writeWorking: () => writer.flush() }), {
    base: opened.base, live: opened.position.clone(), backlog: opened.backlog,
  });
  return engine;
}

/**
 * Session 1: first open online, then two edits through the outbox writer.
 * The working snapshot only reflects the first edit when the tab "crashes".
 */
async function crashedSession(): Promise<IndexedDbProjectStore> {
  server.addSnapshot(PID, makeState({ modifiers: [A] }), 0);
  const store = reopenStore();
  setOutboxStoreForTests(store);
  const port = new FakePort(makeState());
  const opened = await openFromServer({ port, reset: vi.fn(async () => {}), gate: () => true }, {
    store, client: server.client, projectId: PID, userId: 'u-me', meta: null,
  });
  expect(opened.ok).toBe(true);

  const edit1 = setModifiers([A], [mod('A', { speed: 5 })]);
  queueOutboxRow({ id: 'chg-1', projectId: PID, kind: 'command', type: 'SetModifiers', payload: edit1 }, true);
  port.replay({ type: 'SetModifiers', payload: edit1 });
  await flushOutboxWrites();
  // Working snapshot written after edit 1 (debounced writer fired once).
  const position = opened.ok ? opened.project.position : null;
  const order = Math.max(...(await store.getOutbox(PID)).map(r => r.order));
  await store.putWorkingSnapshot(PID, packSnapshot(port.capture(), position, order));

  queueOutboxRow({ id: 'chg-2', projectId: PID, kind: 'live-op', type: 'engine.bpm', payload: { bpm: 140 } });
  port.replay({ type: 'engine.bpm', payload: { bpm: 140 } });
  await flushOutboxWrites();
  // Crash: no further working snapshot, nothing pushed.
  return store;
}

describe('crash recovery', () => {
  it('reopens offline with both edits (only the unreflected row replayed)', async () => {
    const before = await crashedSession();
    server.offline = true;
    const store = reopenStore(before);

    const { port, opened } = await openLocal(store);

    expect(server.calls.filter(c => c.name !== 'load-project')).toEqual([]);
    expect(port.state.modifiers).toEqual([mod('A', { speed: 5 })]);
    expect(port.state.globalBpm).toBe(140);
    expect(port.replayed.map(r => r.type)).toEqual(['engine.bpm']);
    expect(opened.backlog).toBe(true);
    expect((await store.getOutbox(PID)).map(r => r.id)).toEqual(['chg-1', 'chg-2']);
  });

  it('later sync pushes each row exactly once, also after a lost ack and another restart', async () => {
    const before = await crashedSession();
    // chg-1 reached the server, but its ack was lost in the crash.
    server.insert(PID, 'SetModifiers', setModifiers([A], [mod('A', { speed: 5 })]), { changeId: 'chg-1', userId: 'u-me' });
    let store = reopenStore(before);
    const { port, opened } = await openLocal(store);

    await startEngine(store, port, opened).requestSync();

    const pushed = server.calls.filter(c => c.name === 'push-change').flatMap(c => c.body.changes.map((x: { changeId: string }) => x.changeId));
    expect(pushed).toEqual(['chg-2']);
    expect(server.rowsOf(PID).map(r => r.change_id)).toEqual(['chg-1', 'chg-2']);
    expect(await store.getOutbox(PID)).toEqual([]);
    // Own rows are never re-applied on the live state.
    expect(port.replaysOf('SetModifiers')).toEqual([]);
    expect(port.state.modifiers).toEqual([mod('A', { speed: 5 })]);
    expect(port.state.globalBpm).toBe(140);

    // Another restart: nothing left to push, the state is unchanged.
    engine!.stop();
    store = reopenStore(store);
    const again = await openLocal(store);
    expect(again.opened.backlog).toBe(false);
    await startEngine(store, again.port, again.opened).requestSync();
    expect(server.callNames().filter(n => n === 'push-change')).toHaveLength(1);
    expect(again.port.replayed).toEqual([]);
    expect(again.port.state).toEqual(port.state);
  });

  it('a re-push of an already stored change id is acked without a duplicate row', async () => {
    const before = await crashedSession();
    const store = reopenStore(before);
    const { port, opened } = await openLocal(store);
    const e = startEngine(store, port, opened);
    // Push "sent" by the crashed tab: the server has chg-1 (same id) and
    // answers the retry with the existing sequence number.
    server.insert(PID, 'SetModifiers', setModifiers([A], [mod('A', { speed: 5 })]), { changeId: 'chg-1', userId: 'u-me' });

    const seqs = await e.pushForQueue(['chg-1', 'chg-2']);

    expect(server.rowsOf(PID).map(r => r.change_id)).toEqual(['chg-1', 'chg-2']);
    expect(seqs).toEqual([1, 2]);
    expect(await store.getOutbox(PID)).toEqual([]);
  });
});

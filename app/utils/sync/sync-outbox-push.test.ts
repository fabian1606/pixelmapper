import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryProjectStore } from '~/utils/persistence/project-store';
import {
  flushOutboxWrites,
  getUnconfirmedOutboxRows,
  queueOutboxRow,
  setOutboxStoreForTests,
} from '~/utils/persistence/outbox-writer';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import { SyncEngine } from '~/utils/sync/sync-engine';
import { SyncPosition } from '~/utils/sync/sync-position';
import { makeState } from '~/utils/sync/merge/adapters/test-state';
import { FakePort, makeDeps } from '~/utils/sync/sync-test-kit';
import { FakeSyncServer } from '~/utils/sync/sync-test-server';

/** Outbox ordering and acknowledgements of `pushForQueue` (ADR 0004 D8, D9). */

const PID = 'p-push';

let server: FakeSyncServer;
let store: InMemoryProjectStore;
let port: FakePort;
let engine: SyncEngine;

/** Queue a live-op row through the real outbox writer. */
function queue(id: string, bpm: number): void {
  queueOutboxRow({ id, projectId: PID, kind: 'live-op', type: 'engine.bpm', payload: { bpm } });
}

beforeEach(() => {
  reportNetworkSuccess();
  server = new FakeSyncServer();
  store = new InMemoryProjectStore();
  setOutboxStoreForTests(store);
  port = new FakePort(makeState());
  const deps = makeDeps(server, store, port, PID, {
    outbox: { flush: flushOutboxWrites, unconfirmed: () => getUnconfirmedOutboxRows(PID) },
  });
  const base = { snapshot: makeState(), position: SyncPosition.at(0) };
  engine = new SyncEngine(deps, { base, live: SyncPosition.at(0), backlog: false });
});

afterEach(async () => {
  engine.stop();
  await flushOutboxWrites();
  setOutboxStoreForTests(null);
  reportNetworkSuccess();
});

describe('outbox writer + pushForQueue', () => {
  it('keeps enqueue order, pushes in order, acks remove rows, returns sequence numbers per id', async () => {
    queue('a', 1);
    queue('b', 2);
    queue('c', 3);
    // Not durable yet → visible as unconfirmed rows.
    expect(getUnconfirmedOutboxRows(PID).map(r => r.id)).toEqual(['a', 'b', 'c']);
    await flushOutboxWrites();
    const stored = await store.getOutbox(PID);
    expect(stored.map(r => r.id)).toEqual(['a', 'b', 'c']);
    expect(stored.map(r => r.order)).toEqual([...stored.map(r => r.order)].sort((x, y) => x - y));

    const seqs = await engine.pushForQueue(['a', 'b', undefined, 'c']);

    const pushes = server.calls.filter(c => c.name === 'push-change');
    expect(pushes.flatMap(p => p.body.changes.map((c: { changeId: string }) => c.changeId))).toEqual(['a', 'b', 'c']);
    expect(server.rowsOf(PID).map(r => r.change_id)).toEqual(['a', 'b', 'c']);
    expect(seqs).toEqual([1, 2, undefined, 3]);
    expect(await store.getOutbox(PID)).toEqual([]);
  });

  it('an unconfirmed ack keeps its row (and only its row)', async () => {
    queue('a', 1);
    queue('b', 2);
    server.unconfirm.add('b');

    const seqs = await engine.pushForQueue(['a', 'b']);

    expect(seqs).toEqual([1, undefined]);
    expect((await store.getOutbox(PID)).map(r => r.id)).toEqual(['b']);

    // Confirmed on a later push (idempotent by change id).
    server.unconfirm.clear();
    const again = await engine.pushForQueue(['b']);
    expect(again).toEqual([2]);
    expect(await store.getOutbox(PID)).toEqual([]);
    expect(server.rowsOf(PID).map(r => r.change_id)).toEqual(['a', 'b']);
  });

  it('offline: pushForQueue throws a network error and keeps the rows', async () => {
    queue('a', 1);
    await flushOutboxWrites();
    server.offline = true;
    // First call discovers the outage (the backend is unreachable).
    await expect(engine.pushForQueue(['a'])).rejects.toBeInstanceOf(TypeError);
    // Now known offline: rejects without touching the network.
    const before = server.calls.length;
    await expect(engine.pushForQueue(['a'])).rejects.toBeInstanceOf(TypeError);
    expect(server.calls.length).toBe(before);
    expect((await store.getOutbox(PID)).map(r => r.id)).toEqual(['a']);
  });
});

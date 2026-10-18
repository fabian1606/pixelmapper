import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryProjectStore } from '~/utils/persistence/project-store';
import {
  flushOutboxWrites,
  getUnconfirmedOutboxRows,
  queueOutboxRow,
  setOutboxStoreForTests,
} from '~/utils/persistence/outbox-writer';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import { pushHeadless } from '~/utils/sync/project-mirror';
import { SyncEngine, type RemoteInsert } from '~/utils/sync/sync-engine';
import { packSnapshot, SyncPosition } from '~/utils/sync/sync-position';
import { checkpointBase } from '~/utils/sync/sync-push';
import { makeState } from '~/utils/sync/merge/adapters/test-state';
import { appendRow, cloudMeta, FakePort, makeDeps, readWorking, seedBase } from '~/utils/sync/sync-test-kit';
import { FakeSyncServer } from '~/utils/sync/sync-test-server';

/**
 * Regressions of the sync seam review (ADR 0004 §3.2, D8): realtime live-op
 * rows, failed outbox writes, headless acks of rows newer than the working
 * snapshot, permanently rejected pushes.
 */

const PID = 'p-hard';

let server: FakeSyncServer;
let store: InMemoryProjectStore;
let port: FakePort;
let engine: SyncEngine;

/** Realtime insert of a foreign row. */
function insert(seq: number, commandType: string, payload: unknown, changeId = `rt-${seq}`): RemoteInsert {
  return { sequenceNumber: seq, changeId, userId: 'u-other', commandType, payload };
}

beforeEach(() => {
  reportNetworkSuccess();
  server = new FakeSyncServer();
  store = new InMemoryProjectStore();
  setOutboxStoreForTests(store);
  port = new FakePort(makeState({ globalBpm: 100 }));
  engine = new SyncEngine(makeDeps(server, store, port, PID), {
    base: { snapshot: makeState({ globalBpm: 100 }), position: SyncPosition.at(0) },
    live: SyncPosition.at(0),
    backlog: false,
  });
});

afterEach(async () => {
  engine.stop();
  await flushOutboxWrites();
  setOutboxStoreForTests(null);
  reportNetworkSuccess();
});

// ── Realtime live-ops ────────────────────────────────────────────────────────

describe('realtime live-op rows', () => {
  it('regression: a live-op the applier cannot handle is replayed through the port, once', async () => {
    // The collaboration applier only knows history commands.
    const applier = vi.fn((row: RemoteInsert) => row.commandType !== 'engine.bpm');
    engine.setRemoteApplier(applier);
    const row = server.insert(PID, 'engine.bpm', { bpm: 142 });

    engine.handleRemoteInsert(insert(row.sequence_number, 'engine.bpm', { bpm: 142 }, row.change_id));
    expect(port.state.globalBpm).toBe(142);

    // The later pull skips it (recorded as seen): applied exactly once.
    await engine.requestSync();
    expect(port.replaysOf('engine.bpm')).toHaveLength(1);
  });

  it('commands handled by the applier are not replayed again through the port', () => {
    const applier = vi.fn(() => true);
    engine.setRemoteApplier(applier);
    engine.handleRemoteInsert(insert(1, 'engine.bpm', { bpm: 150 }));
    expect(applier).toHaveBeenCalledTimes(1);
    expect(port.replayed).toEqual([]);
  });

  it('without a collaboration applier rows are still applied', () => {
    engine.handleRemoteInsert(insert(1, 'engine.bpm', { bpm: 150 }));
    expect(port.state.globalBpm).toBe(150);
  });
});

// ── Outbox write failure ─────────────────────────────────────────────────────

describe('outbox writer', () => {
  it('regression: rows of a failed batch stay unconfirmed and are written by a retry', async () => {
    const append = store.appendOutbox.bind(store);
    let fail = true;
    vi.spyOn(store, 'appendOutbox').mockImplementation(async (row) => {
      if (fail && row.id === 'b') throw new Error('QuotaExceededError');
      return append(row);
    });
    queueOutboxRow({ id: 'a', projectId: PID, kind: 'live-op', type: 'engine.bpm', payload: { bpm: 1 } });
    queueOutboxRow({ id: 'b', projectId: PID, kind: 'live-op', type: 'engine.bpm', payload: { bpm: 2 } });
    queueOutboxRow({ id: 'c', projectId: PID, kind: 'live-op', type: 'engine.bpm', payload: { bpm: 3 } });

    await flushOutboxWrites();

    expect((await store.getOutbox(PID)).map(r => r.id)).toEqual(['a']);
    expect(getUnconfirmedOutboxRows(PID).map(r => r.id)).toEqual(['b', 'c']);
    // Nothing pending may be checkpointed away.
    const deps = makeDeps(server, store, port, PID, { outbox: { flush: async () => {}, unconfirmed: () => getUnconfirmedOutboxRows(PID) } });
    expect(await checkpointBase(deps, { live: SyncPosition.at(0) } as never)).toBe(false);

    fail = false;
    await flushOutboxWrites();
    expect((await store.getOutbox(PID)).map(r => r.id)).toEqual(['a', 'b', 'c']);
    expect(getUnconfirmedOutboxRows(PID)).toEqual([]);
  });
});

// ── Headless push ────────────────────────────────────────────────────────────

describe('pushHeadless', () => {
  it('regression: rows newer than the working snapshot are not marked as reflected', async () => {
    await store.putProject(cloudMeta(PID));
    await seedBase(store, PID, makeState({ globalBpm: 100 }), SyncPosition.at(0));
    const r1 = await appendRow(store, PID, 'r1', 'engine.bpm', { bpm: 110 }, 'live-op');
    await appendRow(store, PID, 'r2', 'engine.bpm', { bpm: 120 }, 'live-op');
    // The working snapshot reflects r1 only (tab killed during the debounce).
    await store.putWorkingSnapshot(PID, packSnapshot(makeState({ globalBpm: 110 }), SyncPosition.at(0), r1.order));

    expect(await pushHeadless(store, server.client, PID)).toBe(0);

    const working = await readWorking(store, PID);
    expect(working?.position.reflects('r1', 1)).toBe(true);
    // r2 is not in the snapshot: the next open pulls it as a server change.
    expect(working?.position.reflects('r2', 2)).toBe(false);
  });
});

// ── Rejected pushes ──────────────────────────────────────────────────────────

describe('permanently rejected push', () => {
  it('regression: the rejected row is discarded and reported, later rows still go out', async () => {
    await appendRow(store, PID, 'ok-1', 'engine.bpm', { bpm: 1 }, 'live-op');
    await appendRow(store, PID, 'bad', 'engine.bpm', { bpm: 2 }, 'live-op');
    await appendRow(store, PID, 'ok-2', 'engine.bpm', { bpm: 3 }, 'live-op');
    server.reject.set('bad', 422);

    const seqs = await engine.pushForQueue(['ok-1', 'bad', 'ok-2']);

    expect(server.rowsOf(PID).map(r => r.change_id)).toEqual(['ok-1', 'ok-2']);
    expect(seqs).toEqual([1, undefined, 2]);
    expect(await store.getOutbox(PID)).toEqual([]);
    const { syncStatus } = await import('~/utils/sync/project-sync-service');
    expect(syncStatus.value.state).toBe('error');
    expect(syncStatus.value.error).toMatch(/1 change was rejected/);
  });

  it('network errors are not treated as rejections (rows kept)', async () => {
    await appendRow(store, PID, 'a', 'engine.bpm', { bpm: 1 }, 'live-op');
    server.failing.set('push-change', 503);
    await expect(engine.pushForQueue(['a'])).rejects.toThrow();
    expect((await store.getOutbox(PID)).map(r => r.id)).toEqual(['a']);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryProjectStore } from '~/utils/persistence/project-store';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import { loadProject, saveSnapshot } from '~/utils/sync/remote-api';
import type { ReplayableChange } from '~/utils/sync/project-state-port';
import { handleRestoreMarker, resetRemoteRestoreState, setRemoteRestoreHandler } from '~/utils/sync/remote-restore';
import { SyncEngine } from '~/utils/sync/sync-engine';
import { SyncPosition } from '~/utils/sync/sync-position';
import { BEFORE_SYNC_LABEL } from '~/utils/sync/sync-push';
import { restoreBeforeSync } from '~/utils/sync/sync-restore';
import { pushRows } from '~/utils/sync/sync-transport';
import { makeState } from '~/utils/sync/merge/adapters/test-state';
import { appendRow, FakePort, makeDeps, readBase } from '~/utils/sync/sync-test-kit';
import { FakeSyncServer, RESTORE_MARKER } from '~/utils/sync/sync-test-server';

/**
 * Server semantics of migration 009 as seen by the sync layer (fake server):
 * idempotent pushes, foreign change ids, restore markers, snapshot rules.
 */

const PID = 'p-srv';

/** Port that handles restore markers like the engine-state port does. */
class MarkerAwarePort extends FakePort {
  override replay(change: ReplayableChange): boolean {
    if (handleRestoreMarker(change.type)) return true;
    return super.replay(change);
  }
}

/** Let scheduled macrotasks run. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
}

let server: FakeSyncServer;
let store: InMemoryProjectStore;
let engine: SyncEngine | null;

beforeEach(() => {
  reportNetworkSuccess();
  server = new FakeSyncServer();
  store = new InMemoryProjectStore();
  engine = null;
});

afterEach(() => {
  engine?.stop();
  resetRemoteRestoreState();
  reportNetworkSuccess();
});

/** Online engine with nothing pending, base at `seq`. */
function onlineEngine(port: FakePort, seq = 0): SyncEngine {
  const deps = makeDeps(server, store, port, PID);
  engine = new SyncEngine(deps, {
    base: { snapshot: port.capture(), position: SyncPosition.at(seq) },
    live: SyncPosition.at(seq),
    backlog: false,
  });
  return engine;
}

// ── Push ─────────────────────────────────────────────────────────────────────

describe('push after a lost response', () => {
  it('a chunk the server already committed is acknowledged, not wedged', async () => {
    // First attempt committed `a` but the response never arrived.
    const committed = server.insert(PID, 'engine.bpm', { bpm: 120 }, { changeId: 'a', userId: server.userId });
    await appendRow(store, PID, 'a', 'engine.bpm', { bpm: 120 }, 'live-op');
    await appendRow(store, PID, 'b', 'engine.bpm', { bpm: 130 }, 'live-op');

    const res = await pushRows(server.client, PID, await store.getOutbox(PID));

    expect(res.error).toBeNull();
    expect(res.acks[0]).toEqual({ changeId: 'a', sequenceNumber: committed.sequence_number });
    expect(res.acks[1]!.sequenceNumber).toBeGreaterThan(committed.sequence_number);
    expect(server.rowsOf(PID).map(r => r.change_id)).toEqual(['a', 'b']);
  });

  it("another user's row with the same change id is never acknowledged", async () => {
    server.insert(PID, 'engine.bpm', { bpm: 1 }, { changeId: 'a', userId: 'u-other' });
    await appendRow(store, PID, 'a', 'engine.bpm', { bpm: 120 }, 'live-op');
    await appendRow(store, PID, 'b', 'engine.bpm', { bpm: 130 }, 'live-op');

    const res = await pushRows(server.client, PID, await store.getOutbox(PID));

    expect(res.acks[0]).toEqual({ changeId: 'a', sequenceNumber: null });
    // Unconfirmed change blocks later ones (server order = local order).
    expect(res.acks).toHaveLength(2);
    expect(server.rowsOf(PID).find(r => r.change_id === 'a')!.user_id).toBe('u-other');
  });

  it('the same change id in another project is a different change', async () => {
    server.insert('p-other', 'engine.bpm', { bpm: 1 }, { changeId: 'a', userId: server.userId });
    await appendRow(store, PID, 'a', 'engine.bpm', { bpm: 120 }, 'live-op');
    const res = await pushRows(server.client, PID, await store.getOutbox(PID));
    expect(res.acks[0]!.sequenceNumber).not.toBeNull();
    expect(server.rowsOf(PID).map(r => r.change_id)).toEqual(['a']);
  });
});

// ── Restore marker ───────────────────────────────────────────────────────────

describe('restore-snapshot marker', () => {
  it('restore appends a marker and stores the snapshot at its sequence; load-project starts there', async () => {
    const old = makeState({ globalBpm: 90 });
    const snap = server.addSnapshot(PID, old, 0, BEFORE_SYNC_LABEL);
    server.insert(PID, 'engine.bpm', { bpm: 150 });

    const ok = await restoreBeforeSync({
      client: server.client, store, projectId: PID, snapshotId: snap.id,
      closeSession: async () => {}, reload: async () => {},
    });

    expect(ok).toBe(true);
    const marker = server.rowsOf(PID).at(-1)!;
    expect(marker).toMatchObject({ command_type: RESTORE_MARKER, payload: { snapshotId: snap.id }, user_id: server.userId });
    expect(server.latestSnapshot(PID)!.sequence_number).toBe(marker.sequence_number);
    // Local base sits at the marker: the marker itself is never replayed.
    expect((await readBase(store, PID))!.position.reflects(marker.change_id, marker.sequence_number)).toBe(true);

    const loaded = await loadProject(server.client, PID);
    expect(loaded.ok && loaded.data.snapshot?.globalBpm).toBe(90);
    expect(loaded.ok && loaded.data.tail).toEqual([]);
  });

  it('a collaborator pulling the marker schedules exactly one reload, without replaying it', async () => {
    const reload = vi.fn(async () => {});
    setRemoteRestoreHandler(reload);
    const port = new MarkerAwarePort(makeState({ globalBpm: 150 }));
    const snap = server.addSnapshot(PID, makeState({ globalBpm: 90 }), 0, 'Named version');
    onlineEngine(port);

    // Another user restores.
    server.userId = 'u-other';
    await restoreBeforeSync({
      client: server.client, store: new InMemoryProjectStore(), projectId: PID, snapshotId: snap.id,
      closeSession: async () => {}, reload: async () => {},
    });
    server.userId = 'u-me';

    await engine!.requestSync();
    await settle();

    expect(reload).toHaveBeenCalledTimes(1);
    const marker = server.rowsOf(PID).at(-1)!;
    expect(marker.command_type).toBe(RESTORE_MARKER);
    expect(engine!.livePosition().reflects(marker.change_id, marker.sequence_number)).toBe(true);
    // The live state is untouched until the reload replaces it.
    expect(port.state.globalBpm).toBe(150);
  });

  it("the restoring client's own marker echo does not trigger a second reload", async () => {
    const remoteReload = vi.fn(async () => {});
    setRemoteRestoreHandler(remoteReload);
    const snap = server.addSnapshot(PID, makeState(), 0, 'v1');
    await restoreBeforeSync({
      client: server.client, store, projectId: PID, snapshotId: snap.id,
      closeSession: async () => {},
      // The realtime echo arrives while the restore is still running.
      reload: async () => { handleRestoreMarker(RESTORE_MARKER); },
    });
    await settle();
    expect(remoteReload).not.toHaveBeenCalled();
  });
});

// ── Snapshot rules ───────────────────────────────────────────────────────────

describe('snapshot rules', () => {
  it('save-snapshot above the latest change is rejected (400)', async () => {
    server.insert(PID, 'engine.bpm', { bpm: 1 });
    const res = await saveSnapshot(server.client, { projectId: PID, snapshot: makeState(), sequenceNumber: 99 });
    expect(!res.ok && res.error.kind).toBe('bad-request');
    expect(server.snapshots).toEqual([]);
  });

  it('a later safety snapshot never replaces the restored state for loaders', async () => {
    const snap = server.addSnapshot(PID, makeState({ globalBpm: 90 }), 0, 'v1');
    await restoreBeforeSync({
      client: server.client, store, projectId: PID, snapshotId: snap.id,
      closeSession: async () => {}, reload: async () => {},
    });
    const marker = server.rowsOf(PID).at(-1)!;
    // A client that rebased across the marker (pre-restore state) saves its safety snapshot.
    server.addSnapshot(PID, makeState({ globalBpm: 150 }), marker.sequence_number, BEFORE_SYNC_LABEL);

    const loaded = await loadProject(server.client, PID);
    expect(loaded.ok && loaded.data.snapshot?.globalBpm).toBe(90);
  });
});

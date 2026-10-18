import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryProjectStore } from '~/utils/persistence/project-store';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import { SyncEngine, type RemoteInsert } from '~/utils/sync/sync-engine';
import { SyncPosition } from '~/utils/sync/sync-position';
import { makeState, mod } from '~/utils/sync/merge/adapters/test-state';
import { appendRow, FakePort, makeDeps, setModifiers } from '~/utils/sync/sync-test-kit';
import { FakeSyncServer, type ServerRow } from '~/utils/sync/sync-test-server';

/**
 * Out-of-order commits and dedup by change id (ADR 0004 §3.2, sync-position):
 * pulls restart at the floor, realtime inserts never apply a change twice.
 */

const PID = 'p-overlap';

let server: FakeSyncServer;
let store: InMemoryProjectStore;
let port: FakePort;
let engine: SyncEngine;

/** BPM values replayed so far (each foreign change carries a unique BPM). */
function appliedBpms(): number[] {
  return port.replaysOf('engine.bpm').map(r => (r.payload as { bpm: number }).bpm);
}

/** Server row → realtime insert. */
function toInsert(row: ServerRow): RemoteInsert {
  return {
    sequenceNumber: row.sequence_number,
    changeId: row.change_id,
    userId: row.user_id,
    commandType: row.command_type,
    payload: row.payload,
  };
}

beforeEach(() => {
  reportNetworkSuccess();
  server = new FakeSyncServer();
  store = new InMemoryProjectStore();
  port = new FakePort(makeState());
  const deps = makeDeps(server, store, port, PID);
  engine = new SyncEngine(deps, {
    base: { snapshot: makeState(), position: SyncPosition.at(0) },
    live: SyncPosition.at(0),
    backlog: false,
  });
});

afterEach(() => engine.stop());

describe('pull overlap', () => {
  it('a late commit with a lower sequence is applied exactly once by the next pull', async () => {
    server.insert(PID, 'engine.bpm', { bpm: 101 });
    const late = server.reserve();
    server.insert(PID, 'engine.bpm', { bpm: 103 });

    await engine.requestSync();
    expect(appliedBpms()).toEqual([101, 103]);
    expect(engine.livePosition().cursor).toBe(3);

    // The concurrent insert commits after the first pull saw seq 3.
    server.insert(PID, 'engine.bpm', { bpm: 102 }, { seq: late });
    await engine.requestSync();

    const pulls = server.calls.filter(c => c.name === 'pull-changes');
    // The second pull starts at the floor (0), not at the cursor (3).
    expect(pulls.map(p => p.body.afterSequence)).toEqual([0, 0]);
    expect(appliedBpms()).toEqual([101, 103, 102]);

    // A third pull applies nothing new.
    await engine.requestSync();
    expect(appliedBpms()).toEqual([101, 103, 102]);
  });

  it('realtime: already pulled rows and own pushed rows do not reach the applier', async () => {
    const applier = vi.fn();
    engine.setRemoteApplier(applier);
    const pulled = server.insert(PID, 'engine.bpm', { bpm: 101 });
    await engine.requestSync();

    // Echo of a row the pull applied already.
    engine.handleRemoteInsert(toInsert(pulled));
    expect(applier).not.toHaveBeenCalled();

    // Own change: pushed by the engine, then echoed by CDC.
    await appendRow(store, PID, 'own-1', 'engine.bpm', { bpm: 200 }, 'live-op');
    await engine.pushForQueue(['own-1']);
    const own = server.rowsOf(PID).find(r => r.change_id === 'own-1')!;
    engine.handleRemoteInsert(toInsert(own));
    expect(applier).not.toHaveBeenCalled();

    // Positive control: a new foreign row is applied once, its echo via pull is not.
    const fresh = server.insert(PID, 'engine.bpm', { bpm: 300 });
    engine.handleRemoteInsert(toInsert(fresh));
    engine.handleRemoteInsert(toInsert(fresh));
    expect(applier).toHaveBeenCalledTimes(1);
    await engine.requestSync();
    expect(appliedBpms()).toEqual([101]);
  });
});

// ── Realtime while a backlog exists ──────────────────────────────────────────

describe('realtime with pending offline changes', () => {
  /**
   * Regression: a realtime insert that arrived while the engine had a backlog
   * was applied to the live state and recorded in `live`; the next pull saw
   * no unseen foreign change, skipped the rebase and pushed the stale offline
   * payload (wiping the foreign change, no D5 snapshot). Fixed in
   * `sync-cycle.ts`: the rebase decision uses the BASE position.
   */
  it('a foreign change received via realtime before the cycle still forces a rebase', async () => {
    const A1 = mod('A', { speed: 1 });
    const A4 = mod('A', { speed: 4 });
    const B = mod('B');
    const base = makeState({ modifiers: [A1] });
    server.addSnapshot(PID, base, 0);
    await appendRow(store, PID, 'local-1', 'SetModifiers', setModifiers([A1], [A4]));
    port = new FakePort(makeState({ modifiers: [A4] }));
    engine.stop();
    engine = new SyncEngine(makeDeps(server, store, port, PID), {
      base: { snapshot: base, position: SyncPosition.at(0) },
      live: SyncPosition.at(0),
      backlog: true,
    });
    engine.setRemoteApplier(row => port.replay({ type: row.commandType, payload: row.payload, userId: row.userId }));

    const foreign = server.insert(PID, 'SetModifiers', setModifiers([A1], [A1, B]));
    engine.handleRemoteInsert(toInsert(foreign));
    await engine.requestSync();

    const pushed = server.rowsOf(PID).find(r => r.change_id === 'local-1')!;
    expect((pushed.payload as { after: unknown[] }).after).toEqual([A4, B]);
    // Live state rebuilt from the base: B present exactly once, D5 snapshot saved first.
    expect(port.state.modifiers).toEqual([A4, B]);
    const names = server.callNames();
    expect(names.indexOf('save-snapshot')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('save-snapshot')).toBeLessThan(names.indexOf('push-change'));
    expect(await store.getOutbox(PID)).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSnapshot } from '~/utils/engine/serialize';
import { InMemoryProjectStore } from '~/utils/persistence/project-store';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import { onSyncConflicts, type SyncConflictReport } from '~/utils/sync/sync-conflicts';
import { SyncEngine } from '~/utils/sync/sync-engine';
import { SyncPosition } from '~/utils/sync/sync-position';
import { BEFORE_SYNC_LABEL } from '~/utils/sync/sync-push';
import { fixture, makeState, mod } from '~/utils/sync/merge/adapters/test-state';
import { appendRow, clone, FakePort, makeDeps, readBase, seedBase, setModifiers } from '~/utils/sync/sync-test-kit';
import { FakeSyncServer } from '~/utils/sync/sync-test-server';

/**
 * Rebase scenarios complementing `sync-rebase-engine.test.ts` (ADR 0004 §3.2
 * step 4, D4, D5): what a second client sees, a failing safety snapshot,
 * scene changes on deleted fixtures, and the restore id of later rebases.
 */

const PID = 'p-rebase-safety';

let server: FakeSyncServer;
let store: InMemoryProjectStore;
let port: FakePort;
let engine: SyncEngine | null;
let reports: SyncConflictReport[];
let stopReports: () => void;

/** Modifier A with a `speed` param, and a modifier B a collaborator adds. */
const A = (speed: number) => mod('A', { speed });
const B = mod('B', { speed: 9 });

beforeEach(() => {
  reportNetworkSuccess();
  server = new FakeSyncServer();
  store = new InMemoryProjectStore();
  engine = null;
  reports = [];
  stopReports = onSyncConflicts(r => reports.push(r));
});

afterEach(() => {
  engine?.stop();
  stopReports();
  reportNetworkSuccess();
});

/**
 * Offline client on `base` (server seq 0) whose `rows` are in the outbox and
 * applied to the live state; backlog set like an open with pending rows.
 */
async function offlineSession(base: ProjectSnapshot, rows: Array<[id: string, type: string, payload: unknown]>, restore?: (id: string) => Promise<boolean>): Promise<SyncEngine> {
  server.addSnapshot(PID, base, 0);
  await seedBase(store, PID, base, SyncPosition.at(0));
  port = new FakePort(base);
  for (const [id, type, payload] of rows) {
    await appendRow(store, PID, id, type, payload);
    port.replay({ type, payload });
  }
  port.replayed = [];
  const deps = makeDeps(server, store, port, PID, restore ? { restoreBeforeSync: restore } : {});
  engine = new SyncEngine(deps, { base: { snapshot: clone(base), position: SyncPosition.at(0) }, live: SyncPosition.at(0), backlog: true });
  return engine;
}

/** Changes the server received via `push-change`, in order. */
function pushedChanges(): Array<{ changeId: string; commandType: string; payload: any }> {
  return server.calls.filter(c => c.name === 'push-change').flatMap(c => c.body.changes);
}

// ── Second client ────────────────────────────────────────────────────────────

describe('rebased payload seen by another client', () => {
  it('replaying the pushed SetModifiers on the collaborator\'s state keeps B', async () => {
    await offlineSession(makeState({ modifiers: [A(1)] }), [['local-1', 'SetModifiers', setModifiers([A(1)], [A(5)])]]);
    server.insert(PID, 'SetModifiers', setModifiers([A(1)], [A(1), B]));

    await engine!.requestSync();

    // The collaborator's client (state = server state before our push) applies our row.
    const collaborator = new FakePort(makeState({ modifiers: [A(1), B] }));
    collaborator.replay({ type: 'SetModifiers', payload: server.rowsOf(PID).at(-1)!.payload });
    expect(collaborator.state.modifiers).toEqual([A(5), B]);
    expect(collaborator.state).toEqual(port.state);
    // Cursor advanced past the collaborator's row; meta follows the base.
    expect((await readBase(store, PID))?.position.cursor).toBe(1);
  });

  it('modifier.update live-op: the field patch survives the rebase and is pushed unchanged', async () => {
    const patch = { effectId: 'A', changes: {}, paramChanges: { speed: 7 } };
    await offlineSession(makeState({ modifiers: [A(1)] }), [['op-1', 'modifier.update', patch]]);
    server.insert(PID, 'SetModifiers', setModifiers([A(1)], [A(1), B]));

    await engine!.requestSync();

    expect(port.state.modifiers).toEqual([A(7), B]);
    expect(pushedChanges().map(c => c.payload)).toEqual([patch]);
    expect(await store.getOutbox(PID)).toEqual([]);
    expect((await readBase(store, PID))?.snapshot.modifiers).toEqual([A(7), B]);
    expect(reports).toEqual([]);
  });
});

// ── Safety snapshot failure (D5) ─────────────────────────────────────────────

describe('"before offline sync" snapshot cannot be saved', () => {
  const local = { effectId: 'A', changes: {}, paramChanges: { speed: 2 } };
  const remote = { effectId: 'A', changes: {}, paramChanges: { speed: 3 } };

  it('nothing is pushed and no conflict reported; the next cycle saves, pushes and reports', async () => {
    await offlineSession(makeState({ modifiers: [A(1)] }), [['op-1', 'modifier.update', local]]);
    server.insert(PID, 'modifier.update', remote);
    server.failing.set('save-snapshot', 500);

    await engine!.requestSync();

    expect(server.callNames()).toEqual(['pull-changes', 'save-snapshot']);
    expect(pushedChanges()).toEqual([]);
    expect((await store.getOutbox(PID)).map(r => r.id)).toEqual(['op-1']);
    expect(reports).toEqual([]);
    expect(port.state.modifiers).toEqual([A(2)]);

    server.failing.clear();
    await engine!.requestSync();

    expect(server.callNames().slice(2)).toEqual(['pull-changes', 'save-snapshot', 'push-change']);
    expect(server.snapshots.find(s => s.label === BEFORE_SYNC_LABEL)?.snapshot.modifiers).toEqual([A(3)]);
    expect(pushedChanges().map(c => c.changeId)).toEqual(['op-1']);
    expect(await store.getOutbox(PID)).toEqual([]);
    expect(reports).toHaveLength(1);
    // The remote row was applied once (by the rebase), never again directly.
    expect(port.state.modifiers).toEqual([A(2)]);
    expect(port.replaysOf('modifier.update').filter(r => (r.payload as typeof remote).paramChanges.speed === 3)).toHaveLength(1);
  });
});

// ── Skipped scene changes ────────────────────────────────────────────────────

describe('local edits of a fixture the remote deleted', () => {
  it('RenameNode + DeleteNodes are dropped, nothing pushed, no crash', async () => {
    await offlineSession(makeState({ sceneNodes: [fixture('f1'), fixture('f2')] }), [
      ['ren-1', 'RenameNode', { nodeId: 'f1', oldName: 'Ff1', newName: 'Spot' }],
      ['del-1', 'DeleteNodes', { nodeIds: ['f1'] }],
    ]);
    server.insert(PID, 'DeleteNodes', { nodeIds: ['f1'] });

    await engine!.requestSync();

    expect(port.state.sceneNodes.map(n => n.id)).toEqual(['f2']);
    expect(await store.getOutbox(PID)).toEqual([]);
    expect(server.callNames()).toEqual(['pull-changes']);
    expect(engine!.hasBacklog()).toBe(false);
    expect((await readBase(store, PID))?.snapshot.sceneNodes.map(n => n.id)).toEqual(['f2']);
  });
});

// ── Restore id per rebase ────────────────────────────────────────────────────

describe('restore offered for a later rebase', () => {
  it('regression: a skip-only rebase with conflicts never offers the snapshot of an earlier rebase', async () => {
    const restore = vi.fn(async () => true);
    const base = makeState({ modifiers: [A(1)], sceneNodes: [fixture('f1')] });
    await offlineSession(base, [['op-1', 'modifier.update', { effectId: 'A', changes: {}, paramChanges: { speed: 2 } }]], restore);
    server.insert(PID, 'modifier.update', { effectId: 'A', changes: {}, paramChanges: { speed: 3 } });
    await engine!.requestSync();
    expect(reports.map(r => r.canRestore)).toEqual([true]);

    // Offline again: the push fails at the network level → backlog.
    server.offline = true;
    await appendRow(store, PID, 'del-1', 'DeleteNodes', { nodeIds: ['f1'] });
    port.replay({ type: 'DeleteNodes', payload: { nodeIds: ['f1'] } });
    await expect(engine!.pushForQueue(['del-1'])).rejects.toBeInstanceOf(TypeError);
    expect(engine!.hasBacklog()).toBe(true);

    // Meanwhile the collaborator renamed f1: the local delete is dropped (remove-modify).
    reportNetworkSuccess();
    server.offline = false;
    server.insert(PID, 'RenameNode', { nodeId: 'f1', oldName: 'Ff1', newName: 'Kept' });
    await engine!.requestSync();

    expect(port.state.sceneNodes.map(n => n.name)).toEqual(['Kept']);
    expect(await store.getOutbox(PID)).toEqual([]);
    expect(reports).toHaveLength(2);
    expect(reports[1]!.items.map(i => i.conflict.kind)).toEqual(['remove-modify']);
    // No snapshot was saved for this rebase → nothing to restore.
    expect(reports[1]!.canRestore).toBe(false);
    expect(server.snapshots.filter(s => s.label === BEFORE_SYNC_LABEL)).toHaveLength(1);
  });
});

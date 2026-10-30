import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSnapshot } from '~/utils/engine/serialize';
import { InMemoryProjectStore } from '~/utils/persistence/project-store';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import { SyncEngine } from '~/utils/sync/sync-engine';
import { onSyncConflicts, type SyncConflictReport } from '~/utils/sync/sync-conflicts';
import { SyncPosition } from '~/utils/sync/sync-position';
import { BEFORE_SYNC_LABEL } from '~/utils/sync/sync-push';
import { restoreBeforeSync } from '~/utils/sync/sync-restore';
import { makeState, mod } from '~/utils/sync/merge/adapters/test-state';
import { appendRow, FakePort, makeDeps, readBase, seedBase, setModifiers } from '~/utils/sync/sync-test-kit';
import { FakeSyncServer } from '~/utils/sync/sync-test-server';

/** Rebase of offline changes onto concurrent server changes (ADR 0004 §3.2 step 4, D4, D5). */

const PID = 'p-rebase';

let server: FakeSyncServer;
let store: InMemoryProjectStore;
let engine: SyncEngine | null = null;
let unsubscribe: (() => void) | null = null;

beforeEach(() => {
  reportNetworkSuccess();
  server = new FakeSyncServer();
  store = new InMemoryProjectStore();
});

afterEach(() => {
  engine?.stop();
  engine = null;
  unsubscribe?.();
  unsubscribe = null;
});

/**
 * Offline client on `base` (server seq 0) with one pending outbox row
 * already applied to the live state. Returns the port and the engine.
 */
async function offlineClient(base: ProjectSnapshot, local: { id: string; type: string; payload: unknown }, extraDeps = {}) {
  server.addSnapshot(PID, base, 0);
  await seedBase(store, PID, base, SyncPosition.at(0));
  await appendRow(store, PID, local.id, local.type, local.payload);
  const port = new FakePort(base);
  port.replay({ type: local.type, payload: local.payload });
  port.replayed = [];
  const deps = makeDeps(server, store, port, PID, extraDeps);
  engine = new SyncEngine(deps, { base: { snapshot: base, position: SyncPosition.at(0) }, live: SyncPosition.at(0), backlog: true });
  return { port, deps, engine };
}

// ── Rebase ───────────────────────────────────────────────────────────────────

describe('rebase on sync', () => {
  it('local edit of A + foreign add of B → both survive; rebased payload is pushed after the safety snapshot', async () => {
    const A1 = mod('A', { speed: 1 });
    const A4 = mod('A', { speed: 4 });
    const B = mod('B', { speed: 2 });
    const base = makeState({ modifiers: [A1] });
    const { port } = await offlineClient(base, { id: 'local-1', type: 'SetModifiers', payload: setModifiers([A1], [A4]) });
    server.insert(PID, 'SetModifiers', setModifiers([A1], [A1, B]));

    await engine!.requestSync();

    expect(port.state.modifiers).toEqual([A4, B]);
    // Pushed payload is the rebased one (contains B, before = server list).
    const pushed = server.rowsOf(PID).find(r => r.change_id === 'local-1')!;
    expect(pushed.payload).toEqual({ before: [A1, B], after: [A4, B] });
    // `before offline sync` = server state before the push, saved first.
    const names = server.callNames();
    expect(names.indexOf('save-snapshot')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('save-snapshot')).toBeLessThan(names.indexOf('push-change'));
    const safety = server.snapshots.find(s => s.label === BEFORE_SYNC_LABEL)!;
    expect(safety.snapshot.modifiers).toEqual([A1, B]);
    expect(safety.sequence_number).toBe(1);
    // Base in the store = server state (incl. B and the pushed change).
    const stored = await readBase(store, PID);
    expect(stored?.snapshot.modifiers).toEqual([A4, B]);
    expect(stored?.position.reflects(pushed.change_id, pushed.sequence_number)).toBe(true);
    expect(await store.getOutbox(PID)).toEqual([]);
    expect(engine!.hasBacklog()).toBe(false);
  });

  it('same field on both sides → conflict reported after the push, local wins; restore reloads', async () => {
    const reload = vi.fn(async () => {});
    const closeSession = vi.fn(async () => {});
    const reports: SyncConflictReport[] = [];
    let pushedAtReport = false;
    unsubscribe = onSyncConflicts((r) => {
      reports.push(r);
      pushedAtReport = server.rowsOf(PID).some(row => row.change_id === 'local-1');
    });
    const A1 = mod('A', { speed: 1 });
    const base = makeState({ modifiers: [A1] });
    const { port } = await offlineClient(
      base,
      { id: 'local-1', type: 'SetModifiers', payload: setModifiers([A1], [mod('A', { speed: 4 })]) },
      { restoreBeforeSync: (snapshotId: string) => restoreBeforeSync({ client: server.client, store, projectId: PID, snapshotId, closeSession, reload }) },
    );
    server.insert(PID, 'SetModifiers', setModifiers([A1], [mod('A', { speed: 9 })]));

    await engine!.requestSync();

    expect(port.state.modifiers).toEqual([mod('A', { speed: 4 })]);
    expect(reports).toHaveLength(1);
    expect(pushedAtReport).toBe(true);
    const report = reports[0]!;
    expect(report.projectId).toBe(PID);
    expect(report.items).toEqual([{
      changeType: 'SetModifiers',
      conflict: { entityId: 'A', path: ['A', 'params', 'speed'], base: 1, local: 4, remote: 9, kind: 'modify-modify' },
    }]);
    expect(report.canRestore).toBe(true);

    await expect(report.restore()).resolves.toBe(true);
    const safety = server.snapshots.find(s => s.label === BEFORE_SYNC_LABEL)!;
    const restoreCall = server.calls.find(c => c.name === 'restore-snapshot');
    expect(restoreCall?.body).toEqual({ projectId: PID, snapshotId: safety.id });
    expect(closeSession).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect((await readBase(store, PID))?.snapshot.modifiers).toEqual([mod('A', { speed: 9 })]);
  });

  it('pending change whose target was deleted remotely is dropped and never pushed', async () => {
    const A = mod('A', { speed: 1 });
    const base = makeState({ modifiers: [A] });
    const { port } = await offlineClient(base, {
      id: 'local-1',
      type: 'modifier.update',
      payload: { effectId: 'A', changes: { strength: 0.5 } },
    });
    server.insert(PID, 'SetModifiers', setModifiers([A], []));

    await engine!.requestSync();

    expect(port.state.modifiers).toEqual([]);
    expect(await store.getOutbox(PID)).toEqual([]);
    expect(server.callNames()).not.toContain('push-change');
    expect(server.rowsOf(PID).some(r => r.change_id === 'local-1')).toBe(false);
    expect((await readBase(store, PID))?.snapshot.modifiers).toEqual([]);
  });

  /**
   * Regression: a rebase that drops every pending change used to leave
   * `state.safety` set (`pushOutbox` returned before saving it), so the next
   * unrelated online push saved a stale `before offline sync` snapshot.
   * Fixed in `sync-push.ts` `pushOutbox` (empty outbox clears it).
   */
  it('a skip-only rebase leaves no stale "before offline sync" snapshot for later pushes', async () => {
    const A = mod('A', { speed: 1 });
    await offlineClient(makeState({ modifiers: [A] }), {
      id: 'local-1',
      type: 'modifier.update',
      payload: { effectId: 'A', changes: { strength: 0.5 } },
    });
    server.insert(PID, 'SetModifiers', setModifiers([A], []));
    await engine!.requestSync();

    // A normal online edit later on.
    await appendRow(store, PID, 'online-1', 'engine.bpm', { bpm: 130 }, 'live-op');
    await engine!.pushForQueue(['online-1']);

    expect(server.rowsOf(PID).some(r => r.change_id === 'online-1')).toBe(true);
    expect(server.snapshots.filter(s => s.label === BEFORE_SYNC_LABEL)).toEqual([]);
  });
});

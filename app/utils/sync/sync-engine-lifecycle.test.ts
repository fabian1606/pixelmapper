import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryProjectStore } from '~/utils/persistence/project-store';
import { resetCurrentAccount, setCurrentAccountId } from '~/utils/auth/current-account';
import { reportNetworkSuccess } from '~/utils/sync/connectivity';
import type { RemoteClient } from '~/utils/sync/remote-api';
import { SyncEngine } from '~/utils/sync/sync-engine';
import { SyncPosition } from '~/utils/sync/sync-position';
import { makeState, mod } from '~/utils/sync/merge/adapters/test-state';
import { appendRow, FakePort, makeDeps, readBase, seedBase, setModifiers } from '~/utils/sync/sync-test-kit';
import { FakeSyncServer } from '~/utils/sync/sync-test-server';

/**
 * Engine lifecycle across project switches and account changes (ADR 0004
 * D15/D16): `stop()` waits for the running operation, a late step cannot
 * touch the next project, and an engine never syncs as another account.
 */

const PID = 'p-life';

let server: FakeSyncServer;
let store: InMemoryProjectStore;
let engine: SyncEngine | null = null;

beforeEach(() => {
  reportNetworkSuccess();
  resetCurrentAccount();
  server = new FakeSyncServer();
  store = new InMemoryProjectStore();
});

afterEach(async () => {
  await engine?.stop();
  engine = null;
  resetCurrentAccount();
});

/** Client whose first `gated` call waits until `release()` is called (all calls when `gated` is null). */
function gatedClient(inner: RemoteClient, gated: string | null = 'push-change') {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let entered!: () => void;
  const reached = new Promise<void>((r) => { entered = r; });
  const client: RemoteClient = {
    functions: {
      async invoke(name, options) {
        if (gated === null || name === gated) { entered(); await gate; }
        return inner.functions.invoke(name, options);
      },
    },
  };
  return { client, release, reached };
}

/** Engine with one pending row on a synced base. */
async function engineWithPending(over: Parameters<typeof makeDeps>[4] = {}) {
  const base = makeState({ globalBpm: 120 });
  server.addSnapshot(PID, base, 0);
  await seedBase(store, PID, base, SyncPosition.at(0));
  await appendRow(store, PID, 'own-1', 'engine.bpm', { bpm: 130 }, 'live-op');
  const port = new FakePort(makeState({ globalBpm: 130 }));
  const deps = makeDeps(server, store, port, PID, over);
  engine = new SyncEngine(deps, { base: { snapshot: base, position: SyncPosition.at(0) }, live: SyncPosition.at(0), backlog: false });
  return { port, deps, engine };
}

// ── Project switch (stop waits, late steps are blocked) ───────────────────────

describe('stop()', () => {
  it('waits for an in-flight push before resolving', async () => {
    const gated = gatedClient(server.client);
    const { engine: e } = await engineWithPending({ client: gated.client });
    const sync = e.requestSync();
    await gated.reached;
    let stopped = false;
    const stopping = e.stop().then(() => { stopped = true; });
    await new Promise(r => setTimeout(r, 10));
    expect(stopped).toBe(false);
    gated.release();
    await stopping;
    await sync;
    expect(stopped).toBe(true);
  });

  it('a step finishing after stop cannot capture or write the next project', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const gated = gatedClient(server.client);
      const { port, engine: e } = await engineWithPending({ client: gated.client });
      const capture = vi.spyOn(port, 'capture');
      const sync = e.requestSync();
      await vi.waitFor(() => gated.reached);
      await gated.reached;
      // The push hangs longer than stop() waits.
      const stopping = e.stop();
      await vi.advanceTimersByTimeAsync(10_000);
      await stopping;
      // Next project is loaded into the shared port.
      port.state = makeState({ globalBpm: 999 });
      const baseBefore = await readBase(store, PID);
      gated.release();
      await sync;
      expect(capture).not.toHaveBeenCalled();
      const baseAfter = await readBase(store, PID);
      expect(baseAfter?.snapshot.globalBpm).toBe(baseBefore?.snapshot.globalBpm);
      expect(port.state.globalBpm).toBe(999);
    }
    finally {
      vi.useRealTimers();
    }
  });
});

// ── Account binding ──────────────────────────────────────────────────────────

describe('account binding', () => {
  it('does not sync while another account is signed in', async () => {
    const { engine: e } = await engineWithPending();
    setCurrentAccountId('someone-else');
    await e.requestSync();
    expect(server.calls).toEqual([]);
    await expect(e.pushForQueue(['own-1'])).rejects.toThrow();
    expect(server.calls).toEqual([]);
    expect(await store.countPending(PID)).toBe(1);
  });

  it('does not sync after sign-out', async () => {
    const { engine: e } = await engineWithPending();
    setCurrentAccountId(null);
    await e.requestSync();
    expect(server.calls).toEqual([]);
  });

  it('syncs as the bound account', async () => {
    const { engine: e } = await engineWithPending();
    setCurrentAccountId(server.userId);
    await e.requestSync();
    expect(server.rowsOf(PID).map(r => r.change_id)).toEqual(['own-1']);
  });

  it('stops pushing when the account switches during a cycle', async () => {
    // The pull is in flight when the account changes.
    const gated = gatedClient(server.client, null);
    const { engine: e } = await engineWithPending({ client: gated.client });
    setCurrentAccountId(server.userId);
    const sync = e.requestSync();
    await gated.reached;
    // B signs in on this tab while A's pull waits: A's rows are not pushed.
    setCurrentAccountId('user-b');
    gated.release();
    await sync;
    expect(server.rowsOf(PID)).toEqual([]);
    expect(await store.countPending(PID)).toBe(1);
  });
});

// ── Rebase hook ──────────────────────────────────────────────────────────────

describe('onRebased', () => {
  it('fires after a rebase replaced the live state (undo history is stale)', async () => {
    const A1 = mod('A', { speed: 1 });
    const A4 = mod('A', { speed: 4 });
    const B = mod('B', { speed: 2 });
    const base = makeState({ modifiers: [A1] });
    server.addSnapshot(PID, base, 0);
    await seedBase(store, PID, base, SyncPosition.at(0));
    await appendRow(store, PID, 'local-1', 'SetModifiers', setModifiers([A1], [A4]));
    const port = new FakePort(base);
    port.replay({ type: 'SetModifiers', payload: setModifiers([A1], [A4]) });
    server.insert(PID, 'SetModifiers', setModifiers([A1], [A1, B]));
    const onRebased = vi.fn();
    engine = new SyncEngine(makeDeps(server, store, port, PID, { onRebased }), {
      base: { snapshot: base, position: SyncPosition.at(0) }, live: SyncPosition.at(0), backlog: true,
    });
    await engine.requestSync();
    expect(port.state.modifiers).toEqual([A4, B]);
    expect(onRebased).toHaveBeenCalledTimes(1);
  });

  it('does not fire for a plain pull', async () => {
    const onRebased = vi.fn();
    const { engine: e } = await engineWithPending({ onRebased });
    server.insert(PID, 'engine.bpm', { bpm: 90 });
    await e.requestSync();
    expect(onRebased).not.toHaveBeenCalled();
  });
});

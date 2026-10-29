import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import type { ProjectSnapshot } from '~/utils/engine/serialize';
import { FakeSyncServer } from '~/utils/sync/sync-test-server';

/**
 * Regression: a hard reload directly on `/project/<id>` opened the project
 * from the local copy before the WASM engine was ready; `initEngine()` then
 * replaced the applied project with its 20-fixture demo grid, and the active
 * session persisted that grid as the project's state (working snapshot,
 * outbox rows, server snapshot autosave).
 *
 * The WASM engine is mocked like in other engine-store tests (stubbed
 * `Worker`); the test controls when the worker reports `ready`.
 */

// ── Fakes ────────────────────────────────────────────────────────────────────

/** Stubbed engine workers; `ready()` delivers the worker's ready message. */
const workers: Array<{ onmessage: ((e: MessageEvent) => void) | null }> = [];

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor() { workers.push(this); }
  postMessage() {}
  terminate() {}
}

/** Resolve `engine.ready` (the WASM engine finished loading). */
function engineReady(): void {
  for (const w of workers) w.onmessage?.({ data: { type: 'ready' } } as MessageEvent);
}

/** Let promise chains, timers and IndexedDB callbacks settle. */
async function settle(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>(r => setTimeout(r, 0));
}

const PID = 'p-race';
const USER = 'u-me';

let server: FakeSyncServer;

type EngineStoreModule = typeof import('~/stores/engine-store');
type ProjectStoreModule = typeof import('~/utils/persistence/project-store');

/** Supabase-like client: remote calls go to the fake server, auth is static. */
function fakeSupabase() {
  return {
    functions: server.client.functions,
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'token' } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  workers.length = 0;
  // Fresh IndexedDB per test (a "device").
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('Worker', FakeWorker);
  // Built-in modifier plugins are fetched at engine init; no network here.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
  server = new FakeSyncServer();
  server.userId = USER;
  vi.stubGlobal('useSupabaseClient', () => fakeSupabase());
  vi.stubGlobal('useSupabaseUser', () => ref({ id: USER }));
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { supabase: { url: 'http://localhost' } } }));
  vi.stubGlobal('useRouter', () => ({ push: vi.fn() }));
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Fresh modules for one "page load" (singletons: project store, queues). */
async function loadModules(): Promise<{ es: EngineStoreModule; ps: ProjectStoreModule }> {
  const ps = await import('~/utils/persistence/project-store');
  ps.resetProjectStoreForTests();
  const es = await import('~/stores/engine-store');
  return { es, ps };
}

/** The project the user had: two fixtures with string ids. */
async function projectSnapshot(): Promise<ProjectSnapshot> {
  const { Fixture } = await import('~/utils/engine/core/fixture');
  const { serializeProject } = await import('~/utils/engine/serialize');
  const a = Fixture.createRGBFixture('fx-a');
  a.name = 'Stage A';
  const b = Fixture.createRGBFixture('fx-b');
  b.name = 'Stage B';
  return serializeProject([a, b], [], [], { RED: 0, GREEN: 0, BLUE: 0, DIMMER: 0 }, [], [], [], null, 128);
}

/** Fixture ids of a stored/serialized snapshot (flattened). */
function fixtureIds(snap: { sceneNodes?: unknown[] } | null | undefined): Array<string | number> {
  const out: Array<string | number> = [];
  const walk = (nodes: unknown[]) => {
    for (const n of nodes as Array<{ _type?: string; id: string | number; children?: unknown[] }>) {
      if (n.children) walk(n.children);
      else out.push(n.id);
    }
  };
  walk(snap?.sceneNodes ?? []);
  return out;
}

/** Seed the local copy of a previously opened project (reload scenario). */
async function seedLocalCopy(ps: ProjectStoreModule, origin: 'local' | 'cloud'): Promise<ProjectSnapshot> {
  const snap = await projectSnapshot();
  const store = await ps.getProjectStore();
  await store.putProject({
    id: PID, name: 'Race', origin, ownerUserId: origin === 'cloud' ? USER : null,
    serverCursor: 0, createdAt: 1, updatedAt: 1, lastSyncedAt: null,
  });
  await store.putBaseSnapshot(PID, snap, 0);
  await store.putWorkingSnapshot(PID, snap);
  if (origin === 'cloud') server.addSnapshot(PID, snap, 0);
  return snap;
}

/**
 * Like `layouts/project.vue` + `app.vue` on a hard reload: `initEngine()` is
 * started (not awaited), the project is loaded, and the WASM engine becomes
 * ready only after the fast local open had the chance to apply the project.
 */
async function reloadOnProjectPage(es: EngineStoreModule) {
  const engineStore = es.useEngineStore();
  void engineStore.initEngine();
  void engineStore.initEngine(); // app.vue calls it too
  const load = engineStore.loadProject(PID);
  // The local open is fast: give it every chance to finish before WASM.
  await settle();
  engineReady();
  await load;
  await settle();
  return engineStore;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('engine ready after the local open (reload on /project/<id>)', () => {
  it('local project: the scene survives and the working snapshot keeps it', async () => {
    const { es, ps } = await loadModules();
    await seedLocalCopy(ps, 'local');

    const engineStore = await reloadOnProjectPage(es);

    expect(engineStore.flatFixtures.map(f => f.id)).toEqual(['fx-a', 'fx-b']);
    expect(engineStore.projectLoading).toBe(false);

    // Edit-like dirty mark, then close: the working copy is the project's.
    engineStore.markEngineDirty();
    await engineStore.closeSession();
    const store = await ps.getProjectStore();
    expect(fixtureIds(await store.getWorkingSnapshot(PID))).toEqual(['fx-a', 'fx-b']);
  });

  it('cloud project: no demo state reaches the outbox, working copy or server snapshot', async () => {
    const { es, ps } = await loadModules();
    await seedLocalCopy(ps, 'cloud');

    const engineStore = await reloadOnProjectPage(es);
    expect(engineStore.flatFixtures.map(f => f.id)).toEqual(['fx-a', 'fx-b']);

    // Cmd+S: a new server snapshot is saved, and it is the project's state.
    await engineStore.saveSnapshotNow();
    await settle();
    const own = server.snapshots.filter(s => s.project_id === PID);
    expect(own).toHaveLength(2);
    expect(fixtureIds(own.at(-1)?.snapshot)).toEqual(['fx-a', 'fx-b']);

    await engineStore.closeSession();
    const store = await ps.getProjectStore();
    expect(fixtureIds(await store.getWorkingSnapshot(PID))).toEqual(['fx-a', 'fx-b']);
    expect(await store.getOutbox(PID)).toEqual([]);
    // Nothing with demo (numeric) fixture ids was pushed.
    expect(server.rowsOf(PID)).toEqual([]);
  });
});

describe('safety gate: nothing is persisted before the project state is applied', () => {
  it('drops live-ops and snapshot saves during the load and after close', async () => {
    const { es, ps } = await loadModules();
    await seedLocalCopy(ps, 'cloud');
    const pq = await import('~/utils/persistence/persist-queue');
    const store = await ps.getProjectStore();

    const engineStore = es.useEngineStore();
    void engineStore.initEngine();
    const load = engineStore.loadProject(PID);
    await settle();
    // Still loading (WASM not ready): edits / Cmd+S belong to no project yet.
    expect(engineStore.projectLoading).toBe(true);
    pq.enqueueLiveOp('engine.bpm', { bpm: 99 }, 'engine.bpm');
    engineStore.markEngineDirty();
    await engineStore.saveSnapshotNow();
    await pq.flushPersistWal();

    engineReady();
    await load;
    await settle();
    expect(engineStore.flatFixtures.map(f => f.id)).toEqual(['fx-a', 'fx-b']);
    expect(await store.getOutbox(PID)).toEqual([]);
    expect(server.rowsOf(PID)).toEqual([]);
    expect(server.snapshots.filter(s => s.project_id === PID)).toHaveLength(1);

    // Control: once applied, a live-op becomes the project's change.
    pq.enqueueLiveOp('engine.bpm', { bpm: 101 }, 'engine.bpm');
    await engineStore.commitPendingPersistence();
    await settle();
    expect(server.rowsOf(PID).map(r => r.payload)).toEqual([{ bpm: 101 }]);

    // After close: the gate is shut again (no row, no server snapshot).
    await engineStore.closeSession();
    pq.enqueueLiveOp('engine.bpm', { bpm: 55 }, 'engine.bpm');
    await engineStore.saveSnapshotNow();
    await pq.flushPersistWal();
    await settle();
    expect(await store.getOutbox(PID)).toEqual([]);
    expect(server.rowsOf(PID)).toHaveLength(1);
    expect(server.snapshots.filter(s => s.project_id === PID)).toHaveLength(1);
  });
});

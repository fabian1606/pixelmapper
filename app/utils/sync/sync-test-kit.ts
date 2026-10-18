import { vi } from 'vitest';
import type { ProjectSnapshot } from '~/utils/engine/serialize';
import type { ModifierInstance } from '~/utils/engine/types';
import type { LocalProjectMeta, OutboxEntry, ProjectStore } from '~/utils/persistence/project-store';
import type { ProjectStatePort, ReplayableChange } from '~/utils/sync/project-state-port';
import type { OutboxAccess, SyncDeps } from '~/utils/sync/sync-context';
import { packSnapshot, unpackSnapshot, type StoredSyncSnapshot, type SyncPosition } from '~/utils/sync/sync-position';
import type { FakeSyncServer } from '~/utils/sync/sync-test-server';

/**
 * Shared fakes of the sync engine tests (tests only): a `ProjectStatePort`
 * over a plain snapshot, engine deps over a fake server + store, and small
 * setup helpers. The real rebase adapters run on the replayed payloads.
 */

// ── Fake port ────────────────────────────────────────────────────────────────

/** JSON copy (no aliasing between port, store and server). */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Port over an in-memory snapshot. `replay` is a small reducer for the
 * change types the tests use; every replay is recorded in `replayed`.
 */
export class FakePort implements ProjectStatePort {
  state: ProjectSnapshot;
  replayed: ReplayableChange[] = [];

  constructor(state: ProjectSnapshot) {
    this.state = clone(state);
  }

  capture(): ProjectSnapshot {
    return clone(this.state);
  }

  apply(snapshot: ProjectSnapshot): void {
    this.state = clone(snapshot);
  }

  replay(change: ReplayableChange): boolean {
    this.replayed.push(clone(change));
    const p = change.payload as Record<string, any>;
    switch (change.type) {
      case 'SetModifiers':
        this.state.modifiers = clone(p.after);
        return true;
      case 'engine.bpm':
        this.state.globalBpm = p.bpm;
        return true;
      case 'modifier.update': {
        const target = this.state.modifiers.find(m => m.id === p.effectId) as Record<string, any> | undefined;
        if (!target) throw new Error(`modifier ${p.effectId} missing`);
        Object.assign(target, clone(p.changes ?? {}));
        if (p.paramChanges) target.params = { ...target.params, ...clone(p.paramChanges) };
        return true;
      }
      default:
        return false;
    }
  }

  /** Replays of one type (e.g. to count `engine.bpm` applications). */
  replaysOf(type: string): ReplayableChange[] {
    return this.replayed.filter(r => r.type === type);
  }
}

// ── Builders ─────────────────────────────────────────────────────────────────

/** Cloud project meta bound to `ownerUserId`. */
export function cloudMeta(id: string, over: Partial<LocalProjectMeta> = {}): LocalProjectMeta {
  return {
    id,
    name: `Project ${id}`,
    origin: 'cloud',
    ownerUserId: 'u-me',
    serverCursor: 0,
    createdAt: 1,
    updatedAt: 1,
    lastSyncedAt: null,
    ...over,
  };
}

/** `SetModifiers` payload. */
export function setModifiers(before: ModifierInstance[], after: ModifierInstance[]) {
  return { before: clone(before), after: clone(after) };
}

/** Append one outbox row to the store (order assigned by the store). */
export function appendRow(store: ProjectStore, projectId: string, id: string, type: string, payload: unknown, kind: OutboxEntry['kind'] = 'command'): Promise<OutboxEntry> {
  return store.appendOutbox({ id, projectId, kind, type, payload: clone(payload), enqueuedAt: Date.now() });
}

/** Store base (and optionally working) snapshot at `position`. */
export async function seedBase(store: ProjectStore, projectId: string, snapshot: ProjectSnapshot, position: SyncPosition): Promise<void> {
  await store.putBaseSnapshot(projectId, packSnapshot(clone(snapshot), position), position.cursor);
}

/** Stored base snapshot split into snapshot + position (null if missing). */
export async function readBase(store: ProjectStore, projectId: string) {
  const stored = await store.getBaseSnapshot(projectId) as StoredSyncSnapshot | null;
  return stored ? unpackSnapshot(stored, -1) : null;
}

/** Stored working snapshot split into snapshot + position (null if missing). */
export async function readWorking(store: ProjectStore, projectId: string) {
  const stored = await store.getWorkingSnapshot(projectId) as StoredSyncSnapshot | null;
  return stored ? unpackSnapshot(stored, -1) : null;
}

// ── Engine deps ──────────────────────────────────────────────────────────────

/** Outbox access without a writer (rows are appended to the store directly). */
export const NO_UNCONFIRMED: OutboxAccess = { flush: async () => {}, unconfirmed: () => [] };

/** Engine deps over the fake server, a store and a port; spies for hooks. */
export function makeDeps(server: FakeSyncServer, store: ProjectStore, port: FakePort, projectId: string, over: Partial<SyncDeps> = {}): SyncDeps {
  return {
    projectId,
    userId: server.userId,
    client: server.client,
    store,
    port,
    outbox: NO_UNCONFIRMED,
    hasQueuedEntries: () => false,
    writeWorking: vi.fn(async () => {}),
    onLiveChanged: vi.fn(),
    onSequence: vi.fn(),
    periodicMs: 1e9,
    ...over,
  };
}

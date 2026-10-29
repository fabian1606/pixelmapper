import type { ProjectSnapshot } from '~/utils/engine/serialize';
import type { LocalProjectMeta, NewOutboxEntry, OutboxEntry, ProjectStore } from './types';

/**
 * In-memory implementation of `ProjectStore`.
 *
 * Used by tests and as the fallback when IndexedDB is unavailable (e.g.
 * Safari private mode, SSR). Values are structured-cloned on the way in and
 * out so callers observe the same copy semantics as with IndexedDB.
 *
 * Passing the same `InMemoryProjectStoreState` to several instances emulates
 * "reopening" a persistent store (shared data + order counter).
 */

/** Backing data of an in-memory store. */
export interface InMemoryProjectStoreState {
  meta: Map<string, LocalProjectMeta>;
  base: Map<string, ProjectSnapshot>;
  working: Map<string, ProjectSnapshot>;
  outbox: Map<string, OutboxEntry>;
  /** Last assigned outbox order. */
  orderCounter: number;
}

/** Creates empty backing data. */
export function createInMemoryProjectStoreState(): InMemoryProjectStoreState {
  return { meta: new Map(), base: new Map(), working: new Map(), outbox: new Map(), orderCounter: 0 };
}

/** Deep copy mirroring IndexedDB's structured clone. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryProjectStore implements ProjectStore {
  constructor(private readonly state: InMemoryProjectStoreState = createInMemoryProjectStoreState()) {}

  // ── Project meta ───────────────────────────────────────────────────────────

  async listProjects(): Promise<LocalProjectMeta[]> {
    return [...this.state.meta.values()].map(clone);
  }

  async getProject(id: string): Promise<LocalProjectMeta | null> {
    const meta = this.state.meta.get(id);
    return meta ? clone(meta) : null;
  }

  async putProject(meta: LocalProjectMeta): Promise<void> {
    this.state.meta.set(meta.id, clone(meta));
  }

  async deleteProject(id: string): Promise<void> {
    this.state.meta.delete(id);
    this.state.base.delete(id);
    this.state.working.delete(id);
    for (const [entryId, entry] of this.state.outbox) {
      if (entry.projectId === id) this.state.outbox.delete(entryId);
    }
  }

  // ── Snapshots ──────────────────────────────────────────────────────────────

  async getBaseSnapshot(id: string): Promise<ProjectSnapshot | null> {
    const snapshot = this.state.base.get(id);
    return snapshot ? clone(snapshot) : null;
  }

  async putBaseSnapshot(id: string, snapshot: ProjectSnapshot, serverCursor: number): Promise<void> {
    // Clone first: if cloning throws, neither snapshot nor cursor change.
    const copy = clone(snapshot);
    this.state.base.set(id, copy);
    const meta = this.state.meta.get(id);
    if (meta) this.state.meta.set(id, { ...meta, serverCursor });
  }

  async getWorkingSnapshot(id: string): Promise<ProjectSnapshot | null> {
    const snapshot = this.state.working.get(id);
    return snapshot ? clone(snapshot) : null;
  }

  async putWorkingSnapshot(id: string, snapshot: ProjectSnapshot): Promise<void> {
    this.state.working.set(id, clone(snapshot));
  }

  // ── Outbox ─────────────────────────────────────────────────────────────────

  async appendOutbox(entry: NewOutboxEntry): Promise<OutboxEntry> {
    const stored: OutboxEntry = { ...clone(entry), order: this.state.orderCounter + 1 };
    this.state.orderCounter = stored.order;
    // Coalescing (D8): drop the pending entry with the same dedupKey.
    if (entry.dedupKey !== undefined) {
      for (const [entryId, pending] of this.state.outbox) {
        if (pending.projectId === entry.projectId && pending.dedupKey === entry.dedupKey) {
          this.state.outbox.delete(entryId);
        }
      }
    }
    // Delete first so a re-used id moves to the end of the Map as well.
    this.state.outbox.delete(stored.id);
    this.state.outbox.set(stored.id, stored);
    return clone(stored);
  }

  async getOutbox(projectId: string): Promise<OutboxEntry[]> {
    return [...this.state.outbox.values()]
      .filter(entry => entry.projectId === projectId)
      .sort((a, b) => a.order - b.order)
      .map(clone);
  }

  async updateOutbox(entries: OutboxEntry[]): Promise<void> {
    // Clone all first so a clone failure leaves the outbox untouched.
    const copies = entries.map(clone);
    for (const entry of copies) {
      const existing = this.state.outbox.get(entry.id);
      // Acked meanwhile → nothing to rewrite. Order/project stay authoritative.
      if (!existing) continue;
      this.state.outbox.set(entry.id, { ...entry, projectId: existing.projectId, order: existing.order });
    }
  }

  async ackOutbox(ids: string[]): Promise<void> {
    for (const id of ids) this.state.outbox.delete(id);
  }

  async countPending(projectId?: string): Promise<number> {
    if (projectId === undefined) return this.state.outbox.size;
    let count = 0;
    for (const entry of this.state.outbox.values()) {
      if (entry.projectId === projectId) count++;
    }
    return count;
  }

  // ── Maintenance ────────────────────────────────────────────────────────────

  async clearAll(): Promise<void> {
    // The order counter survives, matching the IndexedDB store.
    this.state.meta.clear();
    this.state.base.clear();
    this.state.working.clear();
    this.state.outbox.clear();
  }
}

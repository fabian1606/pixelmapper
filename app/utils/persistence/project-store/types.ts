import type { ProjectSnapshot } from '~/utils/engine/serialize';

/**
 * Contract of the local project store (ADR 0004 §3.1, D1, D12).
 *
 * The first implementation is IndexedDB; a file-based `.pmproject` store MUST
 * be able to implement the same interface later, so callers never query the
 * underlying storage directly.
 */

// ── Project meta ─────────────────────────────────────────────────────────────

export interface LocalProjectMeta {
  /** Client-generated UUID; equals `projects.id` once the project is in the cloud. */
  id: string;
  name: string;
  description?: string;
  /** `local` = never uploaded; `cloud` = linked to a Supabase project. */
  origin: 'local' | 'cloud';
  /** Account the cloud project is bound to (D15). `null` for local projects. */
  ownerUserId: string | null;
  /** Role of `ownerUserId` in the cloud project, if known. */
  role?: 'owner' | 'editor' | 'viewer';
  /** Highest server `sequence_number` contained in the base snapshot. */
  serverCursor: number;
  createdAt: number;
  updatedAt: number;
  lastSyncedAt: number | null;
}

// ── Outbox ───────────────────────────────────────────────────────────────────

export interface OutboxEntry {
  /** Client UUID; equals `project_changes.change_id` on the server. */
  id: string;
  projectId: string;
  /** History command or persistent live-op. */
  kind: 'command' | 'live-op';
  /** `commandType` (commands) or live-op type. */
  type: string;
  payload: unknown;
  /**
   * Coalescing key for high-frequency live-ops (D8). Appending an entry with
   * a dedupKey replaces the pending entry with the same key (the new entry
   * moves to the end of the queue).
   */
  dedupKey?: string;
  /** Monotonic ordering key (assigned by the store on append). */
  order: number;
  enqueuedAt: number;
}

/** Input for `appendOutbox`; the store assigns `order`. */
export type NewOutboxEntry = Omit<OutboxEntry, 'order'>;

// ── Store ────────────────────────────────────────────────────────────────────

export interface ProjectStore {
  /** All locally known projects (meta only). */
  listProjects(): Promise<LocalProjectMeta[]>;
  getProject(id: string): Promise<LocalProjectMeta | null>;
  /** Insert or replace meta. */
  putProject(meta: LocalProjectMeta): Promise<void>;
  /** Remove a project with all snapshots and outbox entries. */
  deleteProject(id: string): Promise<void>;

  /** State at `meta.serverCursor` (no pending changes). */
  getBaseSnapshot(id: string): Promise<ProjectSnapshot | null>;
  putBaseSnapshot(id: string, snapshot: ProjectSnapshot, serverCursor: number): Promise<void>;

  /** Base + pending changes; cache for instant open. */
  getWorkingSnapshot(id: string): Promise<ProjectSnapshot | null>;
  putWorkingSnapshot(id: string, snapshot: ProjectSnapshot): Promise<void>;

  /** Durable append (resolves after the transaction commits). */
  appendOutbox(entry: NewOutboxEntry): Promise<OutboxEntry>;
  /** Pending entries of a project, ordered by `order` ascending. */
  getOutbox(projectId: string): Promise<OutboxEntry[]>;
  /** Replace payloads of pending entries (after a rebase), keeping order. */
  updateOutbox(entries: OutboxEntry[]): Promise<void>;
  /** Remove acknowledged entries. Unknown ids are ignored. */
  ackOutbox(ids: string[]): Promise<void>;
  /** Number of pending entries per project (for the sync status UI). */
  countPending(projectId?: string): Promise<number>;

  /** Delete everything (web logout, D16). */
  clearAll(): Promise<void>;
}

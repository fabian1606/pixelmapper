import type { ProjectSnapshot } from '~/utils/engine/serialize';
import type { LocalProjectMeta, ProjectStore } from '~/utils/persistence/project-store';
import { newUuid } from '~/utils/ids';

/**
 * Local-only project operations (ADR 0004 D3, D11, D15). They touch only the
 * local store — never the outbox or the server — so they work offline.
 */

// ── Create ───────────────────────────────────────────────────────────────────

export interface NewLocalProject {
  name: string;
  description?: string;
  /** Initial state (import); without one the project opens empty. */
  snapshot?: ProjectSnapshot | null;
}

/** Meta of a fresh local-only project with a client UUID (D11). */
export function newLocalMeta(name: string, description?: string, now = Date.now()): LocalProjectMeta {
  return {
    id: newUuid(),
    name: name.trim() || 'Untitled project',
    ...(description ? { description } : {}),
    origin: 'local',
    ownerUserId: null,
    serverCursor: 0,
    createdAt: now,
    updatedAt: now,
    lastSyncedAt: null,
  };
}

/**
 * Creates a local-only project. A given snapshot becomes the working snapshot
 * (local projects have no server base). Returns the new meta.
 */
export async function createLocalProject(store: ProjectStore, input: NewLocalProject): Promise<LocalProjectMeta> {
  const meta = newLocalMeta(input.name, input.description);
  await store.putProject(meta);
  if (input.snapshot) await store.putWorkingSnapshot(meta.id, input.snapshot);
  return meta;
}

// ── Rename / delete ──────────────────────────────────────────────────────────

/** Renames a project in the local store only. Returns false if unknown. */
export async function renameLocalProject(store: ProjectStore, id: string, name: string, description?: string): Promise<boolean> {
  const meta = await store.getProject(id);
  if (!meta) return false;
  const next: LocalProjectMeta = { ...meta, name: name.trim() || meta.name, updatedAt: Date.now() };
  if (description !== undefined) next.description = description || undefined;
  await store.putProject(next);
  return true;
}

/** Removes the copy on this device (meta, snapshots, outbox). */
export async function deleteLocalProject(store: ProjectStore, id: string): Promise<void> {
  await store.deleteProject(id);
}

// ── Detach (D15) ─────────────────────────────────────────────────────────────

/**
 * "Detach as local copy": a new local-only project with a new UUID, a copy of
 * the working snapshot (falls back to the base snapshot) and no outbox.
 * The source project stays untouched. Returns the copy, or null if unknown.
 */
export async function detachAsLocalCopy(store: ProjectStore, sourceId: string): Promise<LocalProjectMeta | null> {
  const source = await store.getProject(sourceId);
  if (!source) return null;
  const snapshot = (await store.getWorkingSnapshot(sourceId)) ?? (await store.getBaseSnapshot(sourceId));
  return createLocalProject(store, {
    name: `${source.name} (local copy)`,
    description: source.description,
    snapshot,
  });
}

// ── Queries ──────────────────────────────────────────────────────────────────

/** Local-only projects that may be offered for upload (D14): never bound to an account. */
export async function listUploadCandidates(store: ProjectStore): Promise<LocalProjectMeta[]> {
  const all = await store.listProjects();
  return all
    .filter(m => m.origin === 'local' && m.ownerUserId === null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Cloud copies bound to `userId` (logout question, D15). */
export async function listBoundCloudProjects(store: ProjectStore, userId: string): Promise<LocalProjectMeta[]> {
  return (await store.listProjects()).filter(m => m.origin === 'cloud' && m.ownerUserId === userId);
}

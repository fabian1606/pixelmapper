import type { LocalProjectMeta, ProjectStore } from '~/utils/persistence/project-store';
import { createProject, type RemoteClient } from '~/utils/sync/remote-api';
import { invokeRemote } from '~/utils/sync/remote-api-invoke';
import type { RemoteResult } from '~/utils/sync/remote-api-types';
import { newUuid } from '~/utils/ids';

/**
 * Cloud project operations through the existing edge functions (online only).
 * The local copy, if one exists, is kept in step so the list (which reads
 * the local store first) shows the result right away.
 */

// ── Create ───────────────────────────────────────────────────────────────────

export interface CreateCloudProjectOptions {
  name: string;
  description?: string;
  userId: string;
  /** Keep a local copy (desktop mirrors every cloud project, D13). */
  cacheLocally: boolean;
}

/** Creates a cloud project with a client UUID (D11). Resolves with its id. */
export async function createCloudProject(
  client: RemoteClient,
  store: ProjectStore,
  opts: CreateCloudProjectOptions,
): Promise<RemoteResult<{ id: string }>> {
  const id = newUuid();
  const res = await createProject(client, {
    id,
    name: opts.name,
    ...(opts.description ? { description: opts.description } : {}),
  });
  if (!res.ok) return res;
  if (opts.cacheLocally) {
    const now = Date.now();
    const meta: LocalProjectMeta = {
      id: res.data.project.id,
      name: res.data.project.name,
      ...(opts.description ? { description: opts.description } : {}),
      origin: 'cloud',
      ownerUserId: opts.userId,
      role: 'owner',
      serverCursor: 0,
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: now,
    };
    await store.putProject(meta);
  }
  return { ok: true, data: { id: res.data.project.id } };
}

// ── Rename / delete ──────────────────────────────────────────────────────────

/** Renames on the server, then the local copy (if any). */
export async function renameCloudProject(
  client: RemoteClient,
  store: ProjectStore,
  id: string,
  name: string,
  description?: string,
): Promise<RemoteResult<true>> {
  const res = await invokeRemote(client, 'rename-project', { projectId: id, name, description: description || undefined }, (d): true | null => (d ? true : null));
  if (!res.ok) return res;
  const meta = await store.getProject(id);
  if (meta) {
    const next: LocalProjectMeta = { ...meta, name, updatedAt: Date.now() };
    next.description = description || undefined;
    await store.putProject(next);
  }
  return res;
}

/** Deletes on the server, then removes the local copy. */
export async function deleteCloudProject(client: RemoteClient, store: ProjectStore, id: string): Promise<RemoteResult<true>> {
  const res = await invokeRemote(client, 'delete-project', { projectId: id }, (): true => true);
  if (!res.ok) return res;
  await store.deleteProject(id);
  return res;
}

import { listProjectsForSync, type RemoteClient } from '~/utils/sync/remote-api';
import { invokeRemote } from '~/utils/sync/remote-api-invoke';
import type { RemoteProjectHead, RemoteResult, RemoteRole } from '~/utils/sync/remote-api-types';

/**
 * Remote project list for the project list page. Uses `list-projects-sync`
 * (D13) and falls back to the older `get-projects` function when the new one
 * is not deployed yet; the fallback has no sync heads (`latestSequence: 0`),
 * which is enough for display and reconciling but never triggers mirroring.
 */
export async function fetchRemoteHeads(client: RemoteClient): Promise<RemoteResult<RemoteProjectHead[]>> {
  const res = await listProjectsForSync(client);
  if (res.ok || (res.error.kind !== 'invalid-response' && res.error.kind !== 'not-found')) return res;
  return invokeRemote(client, 'get-projects', {}, parseLegacyProjects);
}

/** `get-projects` rows → heads without sync data; null if not a list. */
function parseLegacyProjects(data: unknown): RemoteProjectHead[] | null {
  if (!Array.isArray(data)) return null;
  const heads: RemoteProjectHead[] = [];
  for (const row of data) {
    const r = row as Record<string, unknown> | null;
    if (!r || typeof r.id !== 'string') return null;
    const role: RemoteRole = r.role === 'owner' || r.role === 'editor' ? r.role : 'viewer';
    heads.push({
      id: r.id,
      name: typeof r.name === 'string' ? r.name : '',
      description: typeof r.description === 'string' ? r.description : null,
      createdAt: typeof r.created_at === 'string' ? r.created_at : '',
      updatedAt: typeof r.updated_at === 'string' ? r.updated_at : '',
      role,
      ownerId: null,
      latestSequence: 0,
      latestChangeAt: null,
      latestSnapshotSequence: 0,
    });
  }
  return heads;
}

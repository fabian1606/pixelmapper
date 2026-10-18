import type { ProjectSnapshot } from '~/utils/engine/serialize';
import type { LocalProjectMeta, ProjectStore } from '~/utils/persistence/project-store';
import { createProject, type RemoteClient } from '~/utils/sync/remote-api';
import type { RemoteError } from '~/utils/sync/remote-api-types';

/**
 * Local → cloud upload (ADR 0004 D11, D14). The project keeps its id; the
 * working snapshot is sent as the initial server snapshot in one idempotent
 * `create-project` call, so a retry after a lost response is harmless.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type UploadResult =
  | { ok: true; meta: LocalProjectMeta }
  | { ok: false; error: RemoteError | { kind: 'not-found' | 'not-local'; message: string } };

/** Retries while the server reports a create in flight (503), and their base delay. */
const UPLOAD_BUSY_RETRIES = 3;
const UPLOAD_BUSY_DELAY_MS = 1_000;

// ── Upload ───────────────────────────────────────────────────────────────────

/**
 * Uploads one local-only project and binds the local copy to `userId`:
 * `origin: 'cloud'`, `ownerUserId`, `serverCursor` from the response and
 * base snapshot = the uploaded snapshot.
 */
export async function uploadLocalProject(
  client: RemoteClient,
  store: ProjectStore,
  projectId: string,
  userId: string,
): Promise<UploadResult> {
  const meta = await store.getProject(projectId);
  if (!meta) return { ok: false, error: { kind: 'not-found', message: 'Project not found on this device' } };
  if (meta.origin !== 'local' || meta.ownerUserId !== null) {
    return { ok: false, error: { kind: 'not-local', message: 'Only local projects can be uploaded' } };
  }

  const snapshot = await store.getWorkingSnapshot(projectId);
  const input = {
    id: meta.id,
    name: meta.name,
    ...(meta.description ? { description: meta.description } : {}),
    ...(snapshot ? { snapshot } : {}),
  };
  // 503 = a concurrent create of the same id is still running (lost
  // response + retry): wait briefly and ask again. The server then returns
  // the project with the snapshot it stored from THIS request.
  let res = await createProject(client, input);
  for (let attempt = 1; !res.ok && res.error.status === 503 && attempt <= UPLOAD_BUSY_RETRIES; attempt++) {
    await new Promise(resolve => setTimeout(resolve, UPLOAD_BUSY_DELAY_MS * attempt));
    res = await createProject(client, input);
  }
  if (!res.ok) return { ok: false, error: res.error };

  const cursor = res.data.snapshot?.sequenceNumber ?? 0;
  const now = Date.now();
  const next: LocalProjectMeta = {
    ...meta,
    origin: 'cloud',
    ownerUserId: userId,
    role: 'owner',
    serverCursor: cursor,
    updatedAt: now,
    lastSyncedAt: now,
    remoteDeletedAt: null,
  };
  // Meta first (putBaseSnapshot only updates the cursor of existing meta).
  await store.putProject(next);
  if (snapshot) await store.putBaseSnapshot(meta.id, snapshot as ProjectSnapshot, cursor);
  return { ok: true, meta: next };
}

/** Outcome of a batch upload. */
export interface UploadBatchResult {
  uploaded: LocalProjectMeta[];
  failed: { id: string; name: string; message: string }[];
}

/** Uploads several projects one after another (sequential: one request at a time). */
export async function uploadLocalProjects(
  client: RemoteClient,
  store: ProjectStore,
  projectIds: string[],
  userId: string,
): Promise<UploadBatchResult> {
  const out: UploadBatchResult = { uploaded: [], failed: [] };
  for (const id of projectIds) {
    const res = await uploadLocalProject(client, store, id, userId);
    if (res.ok) {
      out.uploaded.push(res.meta);
      continue;
    }
    const name = (await store.getProject(id))?.name ?? id;
    out.failed.push({ id, name, message: describeUploadError(res.error) });
  }
  return out;
}

/** Human-readable reason for a failed upload. */
function describeUploadError(error: { kind: string; message: string }): string {
  if (error.kind === 'network') return 'You are offline';
  if (error.kind === 'conflict') return 'A project with this id already exists on the server';
  return error.message || 'Upload failed';
}

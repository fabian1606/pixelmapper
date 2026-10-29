import type { ProjectSnapshot } from '~/utils/engine/serialize';
import { invokeRemote, type RemoteClient } from '~/utils/sync/remote-api-invoke';
import type {
  CreateProjectInput,
  CreateProjectResult,
  LoadProjectResult,
  PullChangesInput,
  PullChangesResult,
  PushAck,
  PushChangeInput,
  RemoteChange,
  RemoteProject,
  RemoteProjectHead,
  RemoteResult,
  RemoteRole,
  SaveSnapshotInput,
  SnapshotMeta,
} from '~/utils/sync/remote-api-types';

/**
 * Typed wrapper around the sync edge functions (ADR 0004, WP-SERVER).
 *
 * Every function takes the Supabase client (anything with `functions.invoke`),
 * never throws, and returns a `RemoteResult` whose error kind distinguishes
 * network failures (`network`, retry with backoff) from HTTP/auth errors.
 */

export type { RemoteClient } from '~/utils/sync/remote-api-invoke';
export type * from '~/utils/sync/remote-api-types';

// ── Changes ──────────────────────────────────────────────────────────────────

/** Changes with `sequence_number > afterSequence`, ascending, one page. */
export function pullChanges(client: RemoteClient, input: PullChangesInput): Promise<RemoteResult<PullChangesResult>> {
  return invokeRemote(client, 'pull-changes', { ...input }, (data) => {
    const d = asRecord(data);
    const changes = parseChanges(d?.changes);
    if (!d || !changes) return null;
    return {
      changes,
      hasMore: d.hasMore === true,
      nextAfterSequence: num(d.nextAfterSequence, input.afterSequence),
      latestSequence: num(d.latestSequence, 0),
      snapshotSequence: num(d.snapshotSequence, 0),
    };
  });
}

/**
 * Pushes changes (idempotent by `changeId`). Acks are in request order; an ack
 * with `sequenceNumber: null` was not confirmed and must stay in the outbox.
 */
export function pushChanges(
  client: RemoteClient,
  projectId: string,
  changes: PushChangeInput[],
): Promise<RemoteResult<PushAck[]>> {
  return invokeRemote(client, 'push-change', { projectId, changes }, (data) => {
    const d = asRecord(data);
    if (!d || !Array.isArray(d.sequenceNumbers)) return null;
    const seqs = d.sequenceNumbers as unknown[];
    const ids = Array.isArray(d.changeIds) ? d.changeIds as unknown[] : [];
    return changes.map((c, i): PushAck => {
      // The server echoes change ids in request order; a mismatch means "not confirmed".
      // (Postgres returns UUIDs lower-case.)
      const id = ids[i];
      const confirmed = ids.length === 0 || (typeof id === 'string' && id.toLowerCase() === c.changeId.toLowerCase());
      const seq = seqs[i];
      return { changeId: c.changeId, sequenceNumber: confirmed && typeof seq === 'number' ? seq : null };
    });
  });
}

// ── Projects ─────────────────────────────────────────────────────────────────

/** Creates (or idempotently returns) a project, optionally with an initial snapshot. */
export function createProject(client: RemoteClient, input: CreateProjectInput): Promise<RemoteResult<CreateProjectResult>> {
  return invokeRemote(client, 'create-project', { ...input }, (data) => {
    const d = asRecord(data);
    const project = parseProject(d);
    if (!d || !project) return null;
    return {
      project,
      // Old deployments do not send `created`; they always create.
      created: d.created !== false,
      snapshot: parseSnapshotMeta(d.snapshot),
    };
  });
}

/** All projects the user can access (own + shared) with sync heads (D13). */
export function listProjectsForSync(client: RemoteClient): Promise<RemoteResult<RemoteProjectHead[]>> {
  return invokeRemote(client, 'list-projects-sync', {}, (data) => {
    const rows = asRecord(data)?.projects;
    if (!Array.isArray(rows)) return null;
    const heads: RemoteProjectHead[] = [];
    for (const row of rows) {
      const r = asRecord(row);
      const project = parseProject(r);
      if (!r || !project) return null;
      heads.push({
        ...project,
        role: parseRole(r.role),
        ownerId: typeof r.owner_id === 'string' ? r.owner_id : null,
        latestSequence: num(r.latest_sequence, 0),
        latestChangeAt: typeof r.latest_change_at === 'string' ? r.latest_change_at : null,
        latestSnapshotSequence: num(r.latest_snapshot_sequence, 0),
      });
    }
    return heads;
  });
}

// ── Snapshots ────────────────────────────────────────────────────────────────

/** Stores a snapshot at `sequenceNumber`, optionally labelled (D5). */
export function saveSnapshot(client: RemoteClient, input: SaveSnapshotInput): Promise<RemoteResult<SnapshotMeta>> {
  return invokeRemote(client, 'save-snapshot', { ...input }, data => parseSnapshotMeta(data));
}

/** Latest snapshot plus the change tail after it. */
export function loadProject(client: RemoteClient, projectId: string): Promise<RemoteResult<LoadProjectResult>> {
  return invokeRemote(client, 'load-project', { projectId }, (data) => {
    const d = asRecord(data);
    const tail = parseChanges(d?.tail);
    if (!d || !tail) return null;
    const snapshotSequence = num(d.snapshotSequence, 0);
    const tailEnd = tail.length > 0 ? tail[tail.length - 1]!.sequenceNumber : snapshotSequence;
    const latestSequence = num(d.latestSequence, tailEnd);
    return {
      snapshot: (asRecord(d.snapshot) as ProjectSnapshot | null) ?? null,
      snapshotSequence,
      tail,
      latestSequence,
      tailTruncated: tailEnd < latestSequence,
    };
  });
}

// ── Parsing helpers ──────────────────────────────────────────────────────────

/** Object or null. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Number (PostgREST returns bigint as number) or the fallback. */
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** snake_case change rows → `RemoteChange[]`; null if not an array of rows. */
function parseChanges(value: unknown): RemoteChange[] | null {
  if (!Array.isArray(value)) return null;
  const out: RemoteChange[] = [];
  for (const row of value) {
    const r = asRecord(row);
    if (!r || typeof r.sequence_number !== 'number' || typeof r.command_type !== 'string') return null;
    out.push({
      sequenceNumber: r.sequence_number,
      changeId: typeof r.change_id === 'string' ? r.change_id : '',
      userId: typeof r.user_id === 'string' ? r.user_id : '',
      commandType: r.command_type,
      payload: r.payload,
      createdAt: typeof r.created_at === 'string' ? r.created_at : '',
    });
  }
  return out;
}

/** `projects` row → `RemoteProject`; null without an id. */
function parseProject(r: Record<string, unknown> | null): RemoteProject | null {
  if (!r || typeof r.id !== 'string') return null;
  return {
    id: r.id,
    name: typeof r.name === 'string' ? r.name : '',
    description: typeof r.description === 'string' ? r.description : null,
    createdAt: typeof r.created_at === 'string' ? r.created_at : '',
    updatedAt: typeof r.updated_at === 'string' ? r.updated_at : '',
  };
}

/** Snapshot meta row → `SnapshotMeta`; null if absent/invalid. */
function parseSnapshotMeta(value: unknown): SnapshotMeta | null {
  const r = asRecord(value);
  if (!r || typeof r.id !== 'string') return null;
  return {
    id: r.id,
    sequenceNumber: num(r.sequence_number, 0),
    label: typeof r.label === 'string' ? r.label : null,
    createdAt: typeof r.created_at === 'string' ? r.created_at : '',
  };
}

/** Unknown roles degrade to the least privileged one. */
function parseRole(value: unknown): RemoteRole {
  return value === 'owner' || value === 'editor' ? value : 'viewer';
}

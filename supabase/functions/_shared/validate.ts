// ── Request validation for the sync edge functions ─────────────────────────
//
// Pure functions without Deno/Supabase imports, so they can be unit-tested
// with `bun test supabase/functions/_shared`.

/** Default and maximum page size of `pull-changes`. */
export const PULL_DEFAULT_LIMIT = 500;
export const PULL_MAX_LIMIT = 1000;

/** Maximum length of a snapshot label. */
export const SNAPSHOT_LABEL_MAX = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical 8-4-4-4-12 hex UUID (any version, any case). */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** True for a non-negative safe integer. */
export function isSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** True for a plain JSON object (not an array, not null). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Either the parsed value or a client error message (→ HTTP 400). */
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// ── pull-changes ─────────────────────────────────────────────────────────────

export interface PullChangesRequest {
  projectId: string;
  afterSequence: number;
  limit: number;
}

/** `{ projectId, afterSequence, limit? }` — limit is clamped to 1…PULL_MAX_LIMIT. */
export function parsePullChanges(body: Record<string, unknown>): Parsed<PullChangesRequest> {
  const { projectId, afterSequence, limit } = body;
  if (!isUuid(projectId)) return { ok: false, error: 'projectId must be a UUID' };
  if (!isSequence(afterSequence)) return { ok: false, error: 'afterSequence must be a non-negative integer' };
  if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1)) {
    return { ok: false, error: 'limit must be a positive integer' };
  }
  return {
    ok: true,
    value: { projectId, afterSequence, limit: Math.min(limit ?? PULL_DEFAULT_LIMIT, PULL_MAX_LIMIT) },
  };
}

// ── create-project ───────────────────────────────────────────────────────────

export interface CreateProjectRequest {
  /** Client-generated project id (D11); the server generates one if absent. */
  id?: string;
  name: string;
  description?: string;
  /** Initial snapshot stored at sequence 0 (local → cloud upload, D14). */
  snapshot?: Record<string, unknown>;
  /** Label of the initial snapshot. */
  snapshotLabel: string;
}

/** `{ name, description?, id?, snapshot?, snapshotLabel? }`. */
export function parseCreateProject(body: Record<string, unknown>): Parsed<CreateProjectRequest> {
  const { id, name, description, snapshot, snapshotLabel } = body;
  if (typeof name !== 'string' || name.trim() === '') return { ok: false, error: 'name is required' };
  if (id !== undefined && id !== null && !isUuid(id)) return { ok: false, error: 'id must be a UUID' };
  if (description !== undefined && description !== null && typeof description !== 'string') {
    return { ok: false, error: 'description must be a string' };
  }
  if (snapshot !== undefined && snapshot !== null && !isPlainObject(snapshot)) {
    return { ok: false, error: 'snapshot must be an object' };
  }
  const label = parseLabel(snapshotLabel);
  if (!label.ok) return label;
  return {
    ok: true,
    value: {
      id: (id as string | null | undefined)?.toLowerCase() ?? undefined,
      name,
      description: (description as string | null | undefined) ?? undefined,
      snapshot: (snapshot as Record<string, unknown> | null | undefined) ?? undefined,
      snapshotLabel: label.value ?? 'Uploaded',
    },
  };
}

// ── save-snapshot ────────────────────────────────────────────────────────────

export interface SaveSnapshotRequest {
  projectId: string;
  snapshot: Record<string, unknown>;
  sequenceNumber: number;
  label: string | null;
}

/** `{ projectId, snapshot, sequenceNumber, label? }`. */
export function parseSaveSnapshot(body: Record<string, unknown>): Parsed<SaveSnapshotRequest> {
  const { projectId, snapshot, sequenceNumber, label } = body;
  if (typeof projectId !== 'string' || projectId === '' || !isPlainObject(snapshot) || sequenceNumber === undefined) {
    return { ok: false, error: 'projectId, snapshot, sequenceNumber required' };
  }
  // projects.id is a uuid column: anything else would fail in Postgres (22P02 → 500).
  if (!isUuid(projectId)) return { ok: false, error: 'projectId must be a UUID' };
  if (!isSequence(sequenceNumber)) return { ok: false, error: 'sequenceNumber must be a non-negative integer' };
  const parsedLabel = parseLabel(label);
  if (!parsedLabel.ok) return parsedLabel;
  return { ok: true, value: { projectId, snapshot, sequenceNumber, label: parsedLabel.value } };
}

// ── load-project ─────────────────────────────────────────────────────────────

/** `{ projectId }` (load-project). */
export function parseProjectId(body: Record<string, unknown> | null): Parsed<{ projectId: string }> {
  const projectId = body?.projectId;
  if (typeof projectId !== 'string' || projectId === '') return { ok: false, error: 'projectId required' };
  if (!isUuid(projectId)) return { ok: false, error: 'projectId must be a UUID' };
  return { ok: true, value: { projectId } };
}

// ── restore-snapshot ─────────────────────────────────────────────────────────

export interface RestoreSnapshotRequest {
  projectId: string;
  snapshotId: string;
}

/** `{ projectId, snapshotId }` — both UUIDs. */
export function parseRestoreSnapshot(body: Record<string, unknown> | null): Parsed<RestoreSnapshotRequest> {
  const projectId = body?.projectId;
  const snapshotId = body?.snapshotId;
  if (typeof projectId !== 'string' || typeof snapshotId !== 'string' || !projectId || !snapshotId) {
    return { ok: false, error: 'projectId and snapshotId required' };
  }
  if (!isUuid(projectId)) return { ok: false, error: 'projectId must be a UUID' };
  if (!isUuid(snapshotId)) return { ok: false, error: 'snapshotId must be a UUID' };
  return { ok: true, value: { projectId, snapshotId } };
}

// ── list-snapshots ───────────────────────────────────────────────────────────

/** Default and maximum page size of `list-snapshots`. */
export const SNAPSHOTS_DEFAULT_LIMIT = 30;
export const SNAPSHOTS_MAX_LIMIT = 100;

/**
 * Keyset position of a snapshot in the history order
 * (`sequence_number desc, created_at desc, id desc`).
 */
export interface SnapshotCursor {
  sequenceNumber: number;
  /** `created_at` exactly as Postgres returned it (microseconds kept). */
  createdAt: string;
  id: string;
}

export interface ListSnapshotsRequest {
  projectId: string;
  limit: number;
  /** Exclusive cursor: only snapshots older than this one; null = first page. */
  before: SnapshotCursor | null;
}

/** Opaque cursor string `<sequence>~<createdAt>~<id>` (none of the parts contains `~`). */
export function encodeSnapshotCursor(c: SnapshotCursor): string {
  return `${c.sequenceNumber}~${c.createdAt}~${c.id}`;
}

/** Inverse of `encodeSnapshotCursor`; null for anything malformed. */
export function decodeSnapshotCursor(value: unknown): SnapshotCursor | null {
  if (typeof value !== 'string') return null;
  const parts = value.split('~');
  if (parts.length !== 3) return null;
  const [seqText, createdAt, id] = parts as [string, string, string];
  if (!/^\d+$/.test(seqText)) return null;
  const sequenceNumber = Number(seqText);
  if (!isSequence(sequenceNumber)) return null;
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) return null;
  if (!isUuid(id)) return null;
  return { sequenceNumber, createdAt, id: id.toLowerCase() };
}

/** `{ projectId, before?, limit? }` — limit is clamped to 1…SNAPSHOTS_MAX_LIMIT. */
export function parseListSnapshots(body: Record<string, unknown> | null): Parsed<ListSnapshotsRequest> {
  const projectId = body?.projectId;
  if (typeof projectId !== 'string' || projectId === '') return { ok: false, error: 'projectId required' };
  if (!isUuid(projectId)) return { ok: false, error: 'projectId must be a UUID' };
  const limit = body?.limit;
  if (limit !== undefined && limit !== null && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1)) {
    return { ok: false, error: 'limit must be a positive integer' };
  }
  const rawBefore = body?.before;
  let before: SnapshotCursor | null = null;
  if (rawBefore !== undefined && rawBefore !== null) {
    before = decodeSnapshotCursor(rawBefore);
    if (!before) return { ok: false, error: 'before must be a cursor returned by list-snapshots' };
  }
  return {
    ok: true,
    value: { projectId, limit: Math.min((limit as number | null | undefined) ?? SNAPSHOTS_DEFAULT_LIMIT, SNAPSHOTS_MAX_LIMIT), before },
  };
}

// ── push-change ──────────────────────────────────────────────────────────────

/** One change as sent to the `push_changes` RPC. */
export interface PushChangeItem {
  changeId: string;
  commandType: string;
  payload: unknown;
}

export interface PushChangesRequest {
  projectId: string;
  changes: PushChangeItem[];
}

/**
 * Single form `{ projectId, commandType, payload, changeId? }` or array form
 * `{ projectId, changes: [...] }`. A missing `changeId` gets a server UUID
 * (back-compat with old clients; such a push is not idempotent). Change ids
 * are lower-cased, like Postgres returns them.
 */
export function parsePushChanges(
  body: Record<string, unknown>,
  newId: () => string = () => crypto.randomUUID(),
): Parsed<PushChangesRequest> {
  const projectId = body.projectId;
  if (typeof projectId !== 'string' || projectId === '') return { ok: false, error: 'projectId required' };
  if (!isUuid(projectId)) return { ok: false, error: 'projectId must be a UUID' };

  let raw: unknown[];
  if (Array.isArray(body.changes)) raw = body.changes;
  else if (body.commandType && body.payload !== undefined) raw = [{ commandType: body.commandType, payload: body.payload, changeId: body.changeId }];
  else return { ok: false, error: 'either { commandType, payload } or { changes: [...] } required' };

  const changes: PushChangeItem[] = [];
  for (const [i, item] of raw.entries()) {
    if (!isPlainObject(item)) return { ok: false, error: `changes[${i}] must be an object` };
    const { changeId, commandType, payload } = item;
    if (typeof commandType !== 'string' || commandType === '') return { ok: false, error: `changes[${i}].commandType required` };
    if (payload === undefined) return { ok: false, error: `changes[${i}].payload required` };
    if (changeId !== undefined && changeId !== null && !isUuid(changeId)) return { ok: false, error: `changes[${i}].changeId must be a UUID` };
    changes.push({ changeId: ((changeId as string | null | undefined) ?? newId()).toLowerCase(), commandType, payload });
  }
  return { ok: true, value: { projectId, changes } };
}

/** Optional label: string up to SNAPSHOT_LABEL_MAX chars, or null. */
function parseLabel(label: unknown): Parsed<string | null> {
  if (label === undefined || label === null) return { ok: true, value: null };
  if (typeof label !== 'string') return { ok: false, error: 'label must be a string' };
  if (label.length > SNAPSHOT_LABEL_MAX) return { ok: false, error: `label must be at most ${SNAPSHOT_LABEL_MAX} characters` };
  return { ok: true, value: label };
}

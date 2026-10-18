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
  // projectId is only checked for presence: legacy callers may pass any id string.
  if (typeof projectId !== 'string' || projectId === '' || !isPlainObject(snapshot) || sequenceNumber === undefined) {
    return { ok: false, error: 'projectId, snapshot, sequenceNumber required' };
  }
  if (!isSequence(sequenceNumber)) return { ok: false, error: 'sequenceNumber must be a non-negative integer' };
  const parsedLabel = parseLabel(label);
  if (!parsedLabel.ok) return parsedLabel;
  return { ok: true, value: { projectId, snapshot, sequenceNumber, label: parsedLabel.value } };
}

/** Optional label: string up to SNAPSHOT_LABEL_MAX chars, or null. */
function parseLabel(label: unknown): Parsed<string | null> {
  if (label === undefined || label === null) return { ok: true, value: null };
  if (typeof label !== 'string') return { ok: false, error: 'label must be a string' };
  if (label.length > SNAPSHOT_LABEL_MAX) return { ok: false, error: `label must be at most ${SNAPSHOT_LABEL_MAX} characters` };
  return { ok: true, value: label };
}

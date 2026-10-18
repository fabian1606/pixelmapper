import type { ProjectSnapshot } from '~/utils/engine/serialize';

/**
 * Typed request/response shapes of the sync edge functions (ADR 0004, WP-SERVER).
 * Server rows are snake_case; the wrapper maps them to these camelCase types.
 */

// ── Result ───────────────────────────────────────────────────────────────────

/**
 * Failure category:
 * - `network`: the backend was not reached (offline, DNS, CORS, aborted) → retry with backoff.
 * - `auth` (401), `forbidden` (403), `not-found` (404), `conflict` (409), `bad-request` (400/422).
 * - `server`: 5xx or relay failure → retry with backoff.
 * - `invalid-response`: 2xx with an unexpected body (e.g. function not deployed yet).
 * - `unknown`: anything else.
 */
export type RemoteErrorKind =
  | 'network'
  | 'auth'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'bad-request'
  | 'server'
  | 'invalid-response'
  | 'unknown';

export interface RemoteError {
  kind: RemoteErrorKind;
  /** HTTP status, `null` when no response was received. */
  status: number | null;
  /** Server `{ error }` message or a description. */
  message: string;
  /** True for `network` and `server`: the same call may succeed later. */
  retryable: boolean;
  cause?: unknown;
}

/** Discriminated result of every remote call; never throws. */
export type RemoteResult<T> = { ok: true; data: T } | { ok: false; error: RemoteError };

// ── Changes ──────────────────────────────────────────────────────────────────

/** One `project_changes` row. */
export interface RemoteChange {
  sequenceNumber: number;
  changeId: string;
  userId: string;
  commandType: string;
  payload: unknown;
  createdAt: string;
}

export interface PullChangesInput {
  projectId: string;
  /** Exclusive cursor (the client's `serverCursor`). */
  afterSequence: number;
  /** Page size, default 500, max 1000 (server-clamped). */
  limit?: number;
}

export interface PullChangesResult {
  changes: RemoteChange[];
  /** More changes exist after `nextAfterSequence`. */
  hasMore: boolean;
  /** Cursor for the next page. */
  nextAfterSequence: number;
  /** Highest sequence number of the project. */
  latestSequence: number;
  /** Sequence number of the latest server snapshot. */
  snapshotSequence: number;
}

/** Change to push; `changeId` is the outbox entry id (idempotency key). */
export interface PushChangeInput {
  changeId: string;
  commandType: string;
  payload: unknown;
}

/** Server acknowledgement per pushed change, in request order. */
export interface PushAck {
  changeId: string;
  /** `null` when the server did not confirm this change (keep it pending). */
  sequenceNumber: number | null;
}

// ── Projects ─────────────────────────────────────────────────────────────────

export type RemoteRole = 'owner' | 'editor' | 'viewer';

export interface RemoteProject {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  /** Client-generated UUID (D11). Omit to let the server generate one. */
  id?: string;
  name: string;
  description?: string;
  /** Initial state stored as snapshot at sequence 0 (local → cloud upload, D14). */
  snapshot?: ProjectSnapshot;
  /** Label of the initial snapshot (server default: "Uploaded"). */
  snapshotLabel?: string;
}

export interface CreateProjectResult {
  project: RemoteProject;
  /** `false` when the caller already owned a project with this id (idempotent retry). */
  created: boolean;
  /** Meta of the initial snapshot written by this call, if any. */
  snapshot: SnapshotMeta | null;
}

/** Entry of `listProjectsForSync` (D13). */
export interface RemoteProjectHead extends RemoteProject {
  role: RemoteRole;
  ownerId: string | null;
  /** Highest change sequence number; compare with the local cursor to detect edits. */
  latestSequence: number;
  latestChangeAt: string | null;
  latestSnapshotSequence: number;
}

// ── Snapshots ────────────────────────────────────────────────────────────────

export interface SaveSnapshotInput {
  projectId: string;
  snapshot: ProjectSnapshot;
  /** Last change sequence number contained in `snapshot`. */
  sequenceNumber: number;
  /** e.g. "before offline sync" (D5); max 200 chars. */
  label?: string;
}

export interface SnapshotMeta {
  id: string;
  sequenceNumber: number;
  label: string | null;
  createdAt: string;
}

export interface LoadProjectResult {
  snapshot: ProjectSnapshot | null;
  snapshotSequence: number;
  /** Changes after the snapshot, ascending. */
  tail: RemoteChange[];
  /** Highest sequence number of the project. */
  latestSequence: number;
  /**
   * True when the tail ends before `latestSequence` (server row cap): continue
   * with `pullChanges` from the last tail sequence number.
   */
  tailTruncated: boolean;
}

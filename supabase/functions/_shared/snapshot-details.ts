// ── snapshot-details: request parsing + response shaping ────────────────────
//
// Pure functions (no Deno/Supabase imports), unit-tested with
// `bun test supabase/functions/_shared`. Used by `snapshot-details`
// (version-history "what changed", migration 012).

import { isPlainObject, isUuid, type Parsed } from './validate.ts';

// ── Request ──────────────────────────────────────────────────────────────────

export interface SnapshotDetailsRequest {
  projectId: string;
  snapshotId: string;
  /** Older snapshot to compare against; null = the older neighbour in the history order. */
  compareToId: string | null;
}

/** `{ projectId, snapshotId, compareToId? }` — all UUIDs (lower-cased). */
export function parseSnapshotDetails(body: Record<string, unknown> | null): Parsed<SnapshotDetailsRequest> {
  const projectId = body?.projectId;
  const snapshotId = body?.snapshotId;
  const compareToId = body?.compareToId;
  if (typeof projectId !== 'string' || typeof snapshotId !== 'string' || !projectId || !snapshotId) {
    return { ok: false, error: 'projectId and snapshotId required' };
  }
  if (!isUuid(projectId)) return { ok: false, error: 'projectId must be a UUID' };
  if (!isUuid(snapshotId)) return { ok: false, error: 'snapshotId must be a UUID' };
  if (compareToId !== undefined && compareToId !== null && !isUuid(compareToId)) {
    return { ok: false, error: 'compareToId must be a UUID' };
  }
  return {
    ok: true,
    value: {
      projectId: projectId.toLowerCase(),
      snapshotId: snapshotId.toLowerCase(),
      compareToId: typeof compareToId === 'string' ? compareToId.toLowerCase() : null,
    },
  };
}

// ── RPC rows (migration 012) ─────────────────────────────────────────────────

/** Row of `snapshot_details_pair`: the requested snapshot and the one it is compared to. */
export interface SnapshotPairRow {
  slot: 'current' | 'previous' | string;
  id: string;
  sequence_number: number | string;
  label: string | null;
  created_at: string | null;
  snapshot: unknown;
}

/** Row of `snapshot_activity`: changes aggregated per author and command type. */
export interface ActivityRow {
  user_id: string | null;
  author_name: string | null;
  command_type: string;
  change_count: number | string;
}

/** Row of `snapshot_restore_markers`: one `restore-snapshot` marker change. */
export interface RestoreMarkerRow {
  sequence_number: number | string;
  created_at: string | null;
  user_id: string | null;
  author_name: string | null;
  source_snapshot_id: string | null;
  source_sequence: number | string | null;
  source_created_at: string | null;
  source_label: string | null;
}

// ── Response ─────────────────────────────────────────────────────────────────

/** One snapshot with its serialized project state. */
export interface DetailSnapshot {
  id: string;
  sequenceNumber: number;
  label: string | null;
  createdAt: string | null;
  data: Record<string, unknown>;
}

export interface DetailActivity {
  userId: string | null;
  authorName: string | null;
  commandType: string;
  count: number;
}

export interface DetailRestore {
  sequenceNumber: number;
  createdAt: string | null;
  userId: string | null;
  authorName: string | null;
  /** Snapshot that was restored (null if the marker had no valid id). */
  snapshotId: string | null;
  sourceSequence: number | null;
  sourceCreatedAt: string | null;
  sourceLabel: string | null;
}

export interface SnapshotDetailsResponse {
  snapshot: DetailSnapshot;
  /** Older snapshot it is compared to; null for the first version. */
  previous: DetailSnapshot | null;
  /** Changes in (previous.sequence, snapshot.sequence], restore markers excluded. */
  activity: DetailActivity[];
  /** Restore markers in that range, newest first. */
  restores: DetailRestore[];
  /** The restore that produced `snapshot` (marker at its sequence), if any. */
  restoredFrom: DetailRestore | null;
}

/** Splits the pair rows; `current` is null when the snapshot does not exist. */
export function splitPair(rows: SnapshotPairRow[]): { current: DetailSnapshot | null; previous: DetailSnapshot | null } {
  const cur = rows.find(r => r.slot === 'current');
  const prev = rows.find(r => r.slot === 'previous');
  return { current: cur ? toSnapshot(cur) : null, previous: prev ? toSnapshot(prev) : null };
}

/** Sequence range `(after, upto]` of a query. */
export interface SeqRange { after: number; upto: number }

/**
 * Ranges to query. Activity: `(previous.seq, current.seq]`, none for the first
 * version. Restore markers: the same range, or just `current.seq` without a
 * previous version (a restore marker sits exactly at its snapshot's sequence).
 */
export function detailRanges(current: DetailSnapshot, previous: DetailSnapshot | null): { activity: SeqRange | null; restores: SeqRange } {
  const upto = current.sequenceNumber;
  if (!previous) return { activity: null, restores: { after: upto - 1, upto } };
  const after = Math.min(previous.sequenceNumber, upto);
  return { activity: { after, upto }, restores: { after: Math.min(after, upto - 1), upto } };
}

/** Builds the response body from the RPC rows. */
export function toSnapshotDetailsResponse(
  current: DetailSnapshot,
  previous: DetailSnapshot | null,
  activityRows: ActivityRow[],
  restoreRows: RestoreMarkerRow[],
): SnapshotDetailsResponse {
  const restores = restoreRows.map(toRestore).sort((a, b) => b.sequenceNumber - a.sequenceNumber);
  const restoredFrom = restores.find(r => r.sequenceNumber === current.sequenceNumber) ?? null;
  // Restore markers outside the activity range (first version) are only used for `restoredFrom`.
  const inRange = previous ? restores.filter(r => r.sequenceNumber > previous.sequenceNumber) : [];
  return {
    snapshot: current,
    previous,
    activity: activityRows.map(toActivity).filter(a => a.count > 0),
    restores: inRange,
    restoredFrom,
  };
}

// ── Row mapping ──────────────────────────────────────────────────────────────

function toSnapshot(row: SnapshotPairRow): DetailSnapshot {
  return {
    id: row.id,
    sequenceNumber: Number(row.sequence_number),
    label: row.label,
    createdAt: row.created_at,
    data: isPlainObject(row.snapshot) ? row.snapshot : {},
  };
}

function toActivity(row: ActivityRow): DetailActivity {
  return {
    userId: row.user_id,
    authorName: row.author_name,
    commandType: row.command_type,
    count: Number(row.change_count) || 0,
  };
}

function toRestore(row: RestoreMarkerRow): DetailRestore {
  return {
    sequenceNumber: Number(row.sequence_number),
    createdAt: row.created_at,
    userId: row.user_id,
    authorName: row.author_name,
    snapshotId: row.source_snapshot_id,
    sourceSequence: row.source_sequence === null ? null : Number(row.source_sequence),
    sourceCreatedAt: row.source_created_at,
    sourceLabel: row.source_label,
  };
}

import { invokeRemote, type RemoteClient } from '~/utils/sync/remote-api-invoke';
import type { RemoteResult } from '~/utils/sync/remote-api-types';

/**
 * Typed wrapper of the `snapshot-details` edge function (version history
 * "what changed", migration 012). Same conventions as `remote-api.ts`
 * (never throws, `RemoteResult`). The server returns the two snapshots (the
 * client diffs them) and the change log between them aggregated per author
 * and command type — never raw change payloads.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** One snapshot with its serialized project state (`ProjectSnapshot`-like JSON). */
export interface DetailSnapshot {
  id: string;
  sequenceNumber: number;
  label: string | null;
  createdAt: string | null;
  data: Record<string, unknown>;
}

/** Changes of one author and command type between the two snapshots. */
export interface ActivityEntry {
  userId: string | null;
  authorName: string | null;
  commandType: string;
  count: number;
}

/** A `restore-snapshot` marker and the snapshot it restored. */
export interface RestoreMarker {
  sequenceNumber: number;
  createdAt: string | null;
  userId: string | null;
  authorName: string | null;
  snapshotId: string | null;
  sourceSequence: number | null;
  sourceCreatedAt: string | null;
  sourceLabel: string | null;
}

export interface SnapshotDetails {
  snapshot: DetailSnapshot;
  /** Older snapshot compared to; null = first version. */
  previous: DetailSnapshot | null;
  activity: ActivityEntry[];
  /** Restore markers between the two snapshots, newest first. */
  restores: RestoreMarker[];
  /** The restore that produced `snapshot`, if any. */
  restoredFrom: RestoreMarker | null;
}

export interface SnapshotDetailsInput {
  projectId: string;
  snapshotId: string;
  /** Older snapshot to compare with; omitted = its neighbour in the history. */
  compareToId?: string | null;
}

// ── API ──────────────────────────────────────────────────────────────────────

/** Loads the details of one version-history entry. */
export function getSnapshotDetails(client: RemoteClient, input: SnapshotDetailsInput): Promise<RemoteResult<SnapshotDetails>> {
  const body: Record<string, unknown> = { projectId: input.projectId, snapshotId: input.snapshotId };
  if (input.compareToId) body.compareToId = input.compareToId;
  return invokeRemote(client, 'snapshot-details', body, parseSnapshotDetailsResponse);
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/** Validates the response body; null for an unexpected shape. */
export function parseSnapshotDetailsResponse(data: unknown): SnapshotDetails | null {
  const d = asRecord(data);
  if (!d) return null;
  const snapshot = parseSnapshot(d.snapshot);
  if (!snapshot) return null;
  const previous = d.previous == null ? null : parseSnapshot(d.previous);
  if (d.previous != null && !previous) return null;
  return {
    snapshot,
    previous,
    activity: (Array.isArray(d.activity) ? d.activity : []).map(parseActivity).filter((a): a is ActivityEntry => !!a),
    restores: (Array.isArray(d.restores) ? d.restores : []).map(parseRestore).filter((r): r is RestoreMarker => !!r),
    restoredFrom: d.restoredFrom == null ? null : parseRestore(d.restoredFrom),
  };
}

/** Snapshot with id and sequence; `data` defaults to `{}`. */
function parseSnapshot(raw: unknown): DetailSnapshot | null {
  const r = asRecord(raw);
  if (!r || typeof r.id !== 'string') return null;
  const seq = Number(r.sequenceNumber);
  if (!Number.isFinite(seq)) return null;
  return {
    id: r.id,
    sequenceNumber: seq,
    label: str(r.label),
    createdAt: str(r.createdAt),
    data: asRecord(r.data) ?? {},
  };
}

/** Activity row; null without a command type or a positive count. */
function parseActivity(raw: unknown): ActivityEntry | null {
  const r = asRecord(raw);
  const count = Number(r?.count);
  if (!r || typeof r.commandType !== 'string' || !(count > 0)) return null;
  return { userId: str(r.userId), authorName: str(r.authorName) || null, commandType: r.commandType, count: Math.floor(count) };
}

/** Restore marker; null without a sequence number. */
function parseRestore(raw: unknown): RestoreMarker | null {
  const r = asRecord(raw);
  const seq = Number(r?.sequenceNumber);
  if (!r || r.sequenceNumber == null || !Number.isFinite(seq)) return null;
  const src = r.sourceSequence == null ? null : Number(r.sourceSequence);
  return {
    sequenceNumber: seq,
    createdAt: str(r.createdAt),
    userId: str(r.userId),
    authorName: str(r.authorName) || null,
    snapshotId: str(r.snapshotId),
    sourceSequence: src !== null && Number.isFinite(src) ? src : null,
    sourceCreatedAt: str(r.sourceCreatedAt),
    sourceLabel: str(r.sourceLabel),
  };
}

/** Plain object or null. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** String or null. */
function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

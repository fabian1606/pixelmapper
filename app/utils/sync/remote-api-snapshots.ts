import { invokeRemote, type RemoteClient } from '~/utils/sync/remote-api-invoke';
import type { RemoteResult } from '~/utils/sync/remote-api-types';

/**
 * Typed wrapper of the `list-snapshots` edge function (version history,
 * ADR 0004 D17, migration 010). Same conventions as `remote-api.ts`
 * (never throws, `RemoteResult`). The server never returns snapshot JSON
 * here, only metadata and a summary computed in SQL.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Counts of one snapshot (nested group children included). */
export interface SnapshotSummary {
  fixtures: number;
  groups: number;
  modifiers: number;
}

/** One server snapshot in the version history. */
export interface SnapshotListEntry {
  id: string;
  sequenceNumber: number;
  /** e.g. "Uploaded", "before offline sync", "Restored from snapshot 12"; null = autosave. */
  label: string | null;
  /** ISO timestamp. */
  createdAt: string;
  createdBy: string | null;
  /** Display name of `createdBy`, if known. */
  authorName: string | null;
  summary: SnapshotSummary;
}

export interface ListSnapshotsInput {
  projectId: string;
  /** Cursor from the previous page (`nextCursor`); omit for the newest page. */
  before?: string | null;
  /** Page size (server default 30, max 100). */
  limit?: number;
}

export interface ListSnapshotsResult {
  /** Newest first. */
  snapshots: SnapshotListEntry[];
  /** Cursor for older entries; null on the last page. */
  nextCursor: string | null;
}

// ── API ──────────────────────────────────────────────────────────────────────

/** One page of the project's server snapshots, newest first. */
export function listSnapshots(client: RemoteClient, input: ListSnapshotsInput): Promise<RemoteResult<ListSnapshotsResult>> {
  const body: Record<string, unknown> = { projectId: input.projectId };
  if (input.before) body.before = input.before;
  if (input.limit !== undefined) body.limit = input.limit;
  return invokeRemote(client, 'list-snapshots', body, parseListResponse);
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/** Validates the response body; null for an unexpected shape. */
export function parseListResponse(data: unknown): ListSnapshotsResult | null {
  const d = asRecord(data);
  if (!d || !Array.isArray(d.snapshots)) return null;
  const snapshots: SnapshotListEntry[] = [];
  for (const raw of d.snapshots as unknown[]) {
    const entry = parseEntry(raw);
    if (!entry) return null;
    snapshots.push(entry);
  }
  return { snapshots, nextCursor: typeof d.nextCursor === 'string' && d.nextCursor ? d.nextCursor : null };
}

/** One entry; null when id/createdAt/sequenceNumber are missing. */
function parseEntry(raw: unknown): SnapshotListEntry | null {
  const r = asRecord(raw);
  if (!r || typeof r.id !== 'string' || typeof r.createdAt !== 'string') return null;
  const seq = Number(r.sequenceNumber);
  if (!Number.isFinite(seq)) return null;
  const s = asRecord(r.summary);
  return {
    id: r.id,
    sequenceNumber: seq,
    label: typeof r.label === 'string' ? r.label : null,
    createdAt: r.createdAt,
    createdBy: typeof r.createdBy === 'string' ? r.createdBy : null,
    authorName: typeof r.authorName === 'string' && r.authorName ? r.authorName : null,
    summary: { fixtures: count(s?.fixtures), groups: count(s?.groups), modifiers: count(s?.modifiers) },
  };
}

/** Plain object or null. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Non-negative count, 0 for anything else. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

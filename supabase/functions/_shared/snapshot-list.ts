// ── Response shaping of list-snapshots (version history) ────────────────────
//
// Pure functions (no Deno/Supabase imports), unit-tested with
// `bun test supabase/functions/_shared`.

import { encodeSnapshotCursor } from './validate.ts';

/** Row of the `list_snapshot_summaries` RPC (migration 010). */
export interface SnapshotSummaryRow {
  id: string;
  sequence_number: number | string;
  label: string | null;
  created_at: string;
  created_by: string | null;
  author_name: string | null;
  fixtures: number | null;
  groups: number | null;
  modifiers: number | null;
}

/** One entry of the version history (never contains the snapshot JSON). */
export interface SnapshotListEntry {
  id: string;
  sequenceNumber: number;
  label: string | null;
  createdAt: string;
  createdBy: string | null;
  authorName: string | null;
  summary: { fixtures: number; groups: number; modifiers: number };
}

/** Body returned by list-snapshots. */
export interface SnapshotListResponse {
  snapshots: SnapshotListEntry[];
  /** Cursor for the next (older) page, null when this is the last page. */
  nextCursor: string | null;
}

/**
 * Maps RPC rows to the response. The function asks the RPC for `limit + 1`
 * rows: an extra row means there is another page; it is dropped here.
 */
export function toSnapshotListResponse(rows: SnapshotSummaryRow[], limit: number): SnapshotListResponse {
  const page = rows.slice(0, limit);
  const snapshots = page.map(toEntry);
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last
    ? encodeSnapshotCursor({ sequenceNumber: Number(last.sequence_number), createdAt: last.created_at, id: last.id })
    : null;
  return { snapshots, nextCursor };
}

/** snake_case row → camelCase entry (bigint may arrive as a string). */
function toEntry(row: SnapshotSummaryRow): SnapshotListEntry {
  return {
    id: row.id,
    sequenceNumber: Number(row.sequence_number),
    label: row.label,
    createdAt: row.created_at,
    createdBy: row.created_by,
    authorName: row.author_name,
    summary: { fixtures: row.fixtures ?? 0, groups: row.groups ?? 0, modifiers: row.modifiers ?? 0 },
  };
}

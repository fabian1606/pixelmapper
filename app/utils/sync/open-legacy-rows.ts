import type { OutboxEntry } from '~/utils/persistence/project-store';
import type { RemoteClient } from '~/utils/sync/remote-api';
import { pushRows } from '~/utils/sync/sync-transport';

/**
 * Outbox rows found at the FIRST open of a cloud project (moved from the
 * legacy WAL of an older build) that are not in the downloaded tail
 * (ADR 0004 §3.1, D8).
 *
 * Such a row may already be on the server and covered by the server snapshot
 * (pushed, ack lost): replaying it on top of that snapshot would apply it a
 * second time and can revert later changes. There is no lookup by change id,
 * but `push-change` is idempotent by change id and answers with the existing
 * sequence number, so the rows are pushed once and classified by it. Older
 * builds pushed these rows as recorded as well (no rebase existed).
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface LegacySettlement {
  /** On the server at or below the snapshot: already in the snapshot. */
  covered: OutboxEntry[];
  /** Inserted (or found) above the snapshot by this push, in push order. */
  inserted: Array<{ row: OutboxEntry; seq: number }>;
  /** Not confirmed (network error, unconfirmed ack): stay pending. */
  pending: OutboxEntry[];
}

// ── Settlement ───────────────────────────────────────────────────────────────

/** Push `rows` (never throws) and classify them by their sequence number. */
export async function settleLegacyRows(
  client: RemoteClient,
  projectId: string,
  rows: OutboxEntry[],
  snapshotSequence: number,
): Promise<LegacySettlement> {
  const out: LegacySettlement = { covered: [], inserted: [], pending: [] };
  if (rows.length === 0) return out;
  let seqById = new Map<string, number>();
  try {
    const { acks, error } = await pushRows(client, projectId, rows);
    if (error) console.warn('[sync] pushing migrated outbox rows failed:', error.message);
    seqById = new Map(acks.filter(a => a.sequenceNumber != null).map(a => [a.changeId, a.sequenceNumber!]));
  }
  catch (err) {
    console.warn('[sync] pushing migrated outbox rows failed:', err);
  }
  for (const row of rows) {
    const seq = seqById.get(row.id);
    if (seq == null) out.pending.push(row);
    else if (seq <= snapshotSequence) out.covered.push(row);
    else out.inserted.push({ row, seq });
  }
  return out;
}

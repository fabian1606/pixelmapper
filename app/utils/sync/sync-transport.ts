import type { OutboxEntry } from '~/utils/persistence/project-store';
import {
  pullChanges,
  pushChanges,
  type PushAck,
  type RemoteChange,
  type RemoteClient,
  type RemoteError,
  type RemoteResult,
} from '~/utils/sync/remote-api';

/**
 * Paged pull and chunked push on top of `remote-api.ts` (ADR 0004 §3.2).
 * Both never throw and report errors as `RemoteError`.
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Page size of a pull request (server max 1000). */
export const PULL_PAGE_SIZE = 500;
/** Safety cap on pages per pull (500k changes): beyond that, try again later. */
export const PULL_MAX_PAGES = 1000;
/** Changes per push request. */
export const PUSH_CHUNK_SIZE = 200;

// ── Pull ─────────────────────────────────────────────────────────────────────

/** All changes after a sequence, collected over every page. */
export interface PullAllResult {
  changes: RemoteChange[];
  /** Cursor after the last page. */
  nextAfterSequence: number;
  latestSequence: number;
  snapshotSequence: number;
}

/** Pull every page of changes after `afterSequence` (ascending, deduped by id). */
export async function pullAll(client: RemoteClient, projectId: string, afterSequence: number): Promise<RemoteResult<PullAllResult>> {
  const changes: RemoteChange[] = [];
  const ids = new Set<string>();
  let after = afterSequence;
  let latestSequence = 0;
  let snapshotSequence = 0;
  for (let page = 0; page < PULL_MAX_PAGES; page++) {
    const res = await pullChanges(client, { projectId, afterSequence: after, limit: PULL_PAGE_SIZE });
    if (!res.ok) return res;
    for (const c of res.data.changes) {
      // A page boundary can repeat a row when sequences commit out of order.
      if (c.changeId && ids.has(c.changeId)) continue;
      if (c.changeId) ids.add(c.changeId);
      changes.push(c);
    }
    latestSequence = res.data.latestSequence;
    snapshotSequence = res.data.snapshotSequence;
    // Guard against a server that never advances the cursor.
    const next = res.data.nextAfterSequence;
    const advanced = next > after;
    after = Math.max(after, next);
    if (!res.data.hasMore || !advanced) break;
  }
  changes.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  return { ok: true, data: { changes, nextAfterSequence: after, latestSequence, snapshotSequence } };
}

// ── Push ─────────────────────────────────────────────────────────────────────

/** Result of pushing outbox rows: acks so far and the first error, if any. */
export interface PushRowsResult {
  acks: PushAck[];
  error: RemoteError | null;
}

/**
 * Push rows in order, chunk by chunk. Stops at the first failing chunk so the
 * server never receives a later change before an earlier one.
 */
export async function pushRows(client: RemoteClient, projectId: string, rows: OutboxEntry[]): Promise<PushRowsResult> {
  const acks: PushAck[] = [];
  for (let i = 0; i < rows.length; i += PUSH_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + PUSH_CHUNK_SIZE);
    const res = await pushChanges(client, projectId, chunk.map(r => ({
      changeId: r.id,
      commandType: r.type,
      payload: r.payload,
    })));
    if (!res.ok) return { acks, error: res.error };
    acks.push(...res.data);
    // An unconfirmed change blocks later ones (keep server order = local order).
    if (res.data.some(a => a.sequenceNumber == null)) break;
  }
  return { acks, error: null };
}

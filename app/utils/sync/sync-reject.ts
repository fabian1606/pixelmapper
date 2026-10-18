import type { OutboxEntry } from '~/utils/persistence/project-store';
import type { PushAck, RemoteClient, RemoteError } from '~/utils/sync/remote-api';
import { pushRows } from '~/utils/sync/sync-transport';

/**
 * Permanently rejected pushes (ADR 0004 D8, D17).
 *
 * A non-retryable 4xx answer (no write permission, invalid payload, conflict)
 * would keep its row in the outbox forever, and because pushes stop at the
 * first failing row it would block every later change. The rows of the
 * failing request are therefore pushed one by one: rows the server rejects
 * are discarded (and reported), the others go through.
 */

// ── Classification ───────────────────────────────────────────────────────────

/** Error kinds that will not succeed on a retry of the same change. */
const REJECTION_KINDS = new Set<RemoteError['kind']>(['forbidden', 'bad-request', 'conflict']);

/** True when the server refused the change itself (retrying cannot help). */
export function isRejection(error: RemoteError | null): error is RemoteError {
  return !!error && REJECTION_KINDS.has(error.kind);
}

/** Status error shown after rows were discarded. */
export function rejectionError(count: number, cause: RemoteError): RemoteError {
  const what = count === 1 ? '1 change was' : `${count} changes were`;
  return {
    kind: 'bad-request',
    status: cause.status,
    message: `${what} rejected by the server and discarded: ${cause.message}`,
    retryable: false,
    cause,
  };
}

// ── Isolation ────────────────────────────────────────────────────────────────

export interface IsolatedPush {
  acks: PushAck[];
  /** Rows the server rejected (to be removed from the outbox). */
  rejected: OutboxEntry[];
  /** Last rejection (for the message). */
  rejection: RemoteError | null;
  /** First other error: the remaining rows stay pending. */
  error: RemoteError | null;
}

/** Push `rows` one by one in order; never throws. */
export async function pushIsolated(client: RemoteClient, projectId: string, rows: OutboxEntry[]): Promise<IsolatedPush> {
  const out: IsolatedPush = { acks: [], rejected: [], rejection: null, error: null };
  for (const row of rows) {
    const res = await pushRows(client, projectId, [row]);
    if (isRejection(res.error)) {
      out.rejected.push(row);
      out.rejection = res.error;
      continue;
    }
    if (res.error) { out.error = res.error; break; }
    out.acks.push(...res.acks);
    // Unconfirmed: later rows wait (server order = local order).
    if (res.acks.some(a => a.sequenceNumber == null)) break;
  }
  return out;
}

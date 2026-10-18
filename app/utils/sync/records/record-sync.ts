/**
 * One sync round for one record kind of one account (ADR 0004 D21):
 *
 * 1. **Push** dirty records owned by the account (upsert). The server's LWW
 *    trigger skips writes older than the stored row; for those rejected ids
 *    the newer server row is fetched and replaces the local one.
 * 2. **Pull** rows written since the stored cursor (keyset on the server
 *    write time). A remote row replaces the local one unless the local one
 *    is dirty and at least as new; remote tombstones delete locally.
 *
 * Pure functions over `record-db` and a `RecordRemote` — scheduling,
 * backoff and connectivity live in `record-collection.ts`.
 */
import { getMeta, listRecords, mutateRecord, setMeta } from './record-db';
import type { PullCursor, RecordRemote, UserRecord, UserRecordRow, UserRecordRowInput } from './types';

// ── Constants ────────────────────────────────────────────────────────────────

/** Rows per upsert request. */
const PUSH_CHUNK = 100;
/** Rows per pull page. */
const PULL_PAGE = 500;
/**
 * The pull restarts this far before the stored cursor: a transaction that
 * started earlier but committed later than the last pull would otherwise be
 * skipped. Re-applying rows is idempotent.
 */
const PULL_OVERLAP_MS = 5_000;
/** Smallest uuid — keyset tie-breaker for the overlap start. */
const MIN_UUID = '00000000-0000-0000-0000-000000000000';

/** Inputs of one sync round. */
export interface RecordSyncContext {
  remote: RecordRemote;
  kind: string;
  userId: string;
}

// ── Conversions ──────────────────────────────────────────────────────────────

/** Local record → server row. */
function toRow(record: UserRecord, userId: string): UserRecordRowInput {
  return {
    id: record.id,
    user_id: userId,
    kind: record.kind,
    data: record.data,
    updated_at: new Date(record.updatedAt).toISOString(),
    deleted_at: record.deletedAt === null ? null : new Date(record.deletedAt).toISOString(),
  };
}

/** Meta key of the pull cursor. */
export function cursorKey(userId: string, kind: string): string {
  return `cursor:${userId}:${kind}`;
}

// ── Apply remote ─────────────────────────────────────────────────────────────

/**
 * Applies one server row locally (LWW). With `force`, the row replaces the
 * local record unless that changed again after `expectedUpdatedAt` (used for
 * pushes the server rejected because its row is newer).
 */
export async function applyRemoteRow(
  row: UserRecordRow,
  userId: string,
  force?: { expectedUpdatedAt: number },
): Promise<void> {
  const remoteUpdatedAt = Date.parse(row.updated_at);
  await mutateRecord(row.id, (local) => {
    if (local) {
      if (force) {
        if (local.updatedAt !== force.expectedUpdatedAt) return undefined; // edited meanwhile
      }
      else if (local.dirty && local.updatedAt >= remoteUpdatedAt) {
        return undefined; // local change is newer — it will be pushed
      }
      else if (!local.dirty && local.updatedAt === remoteUpdatedAt && local.deletedAt === null && row.deleted_at === null) {
        return undefined; // already up to date
      }
    }
    if (row.deleted_at !== null) return local ? null : undefined;
    return {
      id: row.id,
      kind: row.kind,
      data: row.data,
      updatedAt: remoteUpdatedAt,
      deletedAt: null,
      dirty: false,
      ownerUserId: userId,
    };
  });
}

// ── Push ─────────────────────────────────────────────────────────────────────

/** Marks a pushed record clean (or drops a pushed tombstone) unless it changed meanwhile. */
async function markPushed(record: UserRecord): Promise<void> {
  await mutateRecord(record.id, (local) => {
    if (!local || local.updatedAt !== record.updatedAt) return undefined;
    if (local.deletedAt !== null) return null;
    return { ...local, dirty: false };
  });
}

/** Pushes dirty records of the account. Returns the number of records sent. */
export async function pushDirtyRecords(ctx: RecordSyncContext): Promise<number> {
  const dirty = (await listRecords(ctx.kind)).filter(r => r.dirty && r.ownerUserId === ctx.userId);
  for (let i = 0; i < dirty.length; i += PUSH_CHUNK) {
    const chunk = dirty.slice(i, i + PUSH_CHUNK);
    const accepted = new Set(await ctx.remote.upsert(chunk.map(r => toRow(r, ctx.userId))));
    const rejected = chunk.filter(r => !accepted.has(r.id));
    for (const record of chunk) {
      if (accepted.has(record.id)) await markPushed(record);
    }
    if (rejected.length === 0) continue;
    // The server holds newer versions: adopt them.
    const rows = await ctx.remote.fetchByIds(rejected.map(r => r.id));
    for (const row of rows) {
      const pushed = rejected.find(r => r.id === row.id);
      if (pushed) await applyRemoteRow(row, ctx.userId, { expectedUpdatedAt: pushed.updatedAt });
    }
  }
  return dirty.length;
}

// ── Pull ─────────────────────────────────────────────────────────────────────

/** Pulls rows written since the stored cursor. Returns the number of rows applied. */
export async function pullRemoteRecords(ctx: RecordSyncContext): Promise<number> {
  const key = cursorKey(ctx.userId, ctx.kind);
  const stored = await getMeta<PullCursor>(key);
  let after: PullCursor | null = stored
    ? { ts: new Date(Date.parse(stored.ts) - PULL_OVERLAP_MS).toISOString(), id: MIN_UUID }
    : null;
  let applied = 0;
  let last: PullCursor | null = stored ?? null;

  for (;;) {
    const rows = await ctx.remote.pullPage(ctx.kind, after, PULL_PAGE);
    for (const row of rows) await applyRemoteRow(row, ctx.userId);
    applied += rows.length;
    const tail = rows[rows.length - 1];
    if (tail) {
      after = { ts: tail.server_updated_at, id: tail.id };
      // The overlap may re-read older rows; never move the cursor backwards.
      if (!last || Date.parse(tail.server_updated_at) >= Date.parse(last.ts)) last = after;
    }
    if (rows.length < PULL_PAGE) break;
  }
  if (last && last !== stored) await setMeta(key, last);
  return applied;
}

/** Full round: push first (so rejections are resolved), then pull. */
export async function syncRecordKind(ctx: RecordSyncContext): Promise<void> {
  await pushDirtyRecords(ctx);
  await pullRemoteRecords(ctx);
}

/**
 * Types of the generic user record sync (ADR 0004 D21, WP-RECORDS).
 *
 * A user record is a small JSON document owned by one account (or by no
 * account while the app is used without login). Records are stored in
 * IndexedDB and synced to the `user_records` table, last-writer-wins per
 * record on `updatedAt`.
 */

// ── Local record ─────────────────────────────────────────────────────────────

/** A record as stored locally in IndexedDB. */
export interface UserRecord<T = unknown> {
  /** UUID (ADR 0004 D6). */
  id: string;
  /** Record kind, e.g. `'custom-fixture'`. */
  kind: string;
  /** Kind-specific payload. */
  data: T;
  /** Last local or remote modification (epoch ms) — the LWW clock. */
  updatedAt: number;
  /** Tombstone time (epoch ms) of a deletion that still needs pushing. */
  deletedAt: number | null;
  /** True while the record has local changes the server has not accepted. */
  dirty: boolean;
  /** Account the record belongs to; `null` = local only (never synced). */
  ownerUserId: string | null;
}

/** A visible (non-deleted) record as exposed by a collection. */
export interface RecordItem<T> {
  id: string;
  data: T;
  updatedAt: number;
  ownerUserId: string | null;
}

// ── Server rows ──────────────────────────────────────────────────────────────

/** A row of the `user_records` table as written by the client. */
export interface UserRecordRowInput {
  id: string;
  user_id: string;
  kind: string;
  data: unknown;
  /** ISO timestamp (LWW clock). */
  updated_at: string;
  /** ISO timestamp of the tombstone, or null. */
  deleted_at: string | null;
}

/** A row of the `user_records` table as read from the server. */
export interface UserRecordRow extends UserRecordRowInput {
  /** Server-assigned write time, used as the pull cursor. */
  server_updated_at: string;
}

/** Keyset position of the incremental pull. */
export interface PullCursor {
  /** `server_updated_at` of the last pulled row (exact server string). */
  ts: string;
  /** Id of the last pulled row (tie-breaker for equal timestamps). */
  id: string;
}

// ── Remote ───────────────────────────────────────────────────────────────────

/**
 * Server access used by the sync. Implementations throw on errors; network
 * failures should be recognisable by `isNetworkError` (connectivity.ts).
 */
export interface RecordRemote {
  /**
   * Upserts rows. Returns the ids the server accepted; ids missing from the
   * result were rejected because the stored row is newer (LWW).
   */
  upsert(rows: UserRecordRowInput[]): Promise<string[]>;
  /** Reads rows by id (own rows only). */
  fetchByIds(ids: string[]): Promise<UserRecordRow[]>;
  /**
   * Reads up to `limit` rows of `kind` written after `after`, ordered by
   * `(server_updated_at, id)` ascending. `after = null` reads from the start.
   */
  pullPage(kind: string, after: PullCursor | null, limit: number): Promise<UserRecordRow[]>;
}

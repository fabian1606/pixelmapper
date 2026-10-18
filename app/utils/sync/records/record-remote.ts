/**
 * Supabase implementation of `RecordRemote` (direct table access to
 * `user_records`, protected by RLS — see migration 008).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PullCursor, RecordRemote, UserRecordRow, UserRecordRowInput } from './types';

// ── Constants ────────────────────────────────────────────────────────────────

const TABLE = 'user_records';
const ROW_COLUMNS = 'id, user_id, kind, data, updated_at, deleted_at, server_updated_at';

/** Minimal shape of a PostgREST error. */
interface PostgrestLikeError {
  message: string;
  name?: string;
  code?: string;
}

/** Turns a PostgREST error into a thrown Error that keeps the message (for `isNetworkError`). */
function toError(error: PostgrestLikeError): Error {
  const err = new Error(error.message);
  if (error.name) err.name = error.name;
  return err;
}

// ── Factory ──────────────────────────────────────────────────────────────────

/** Creates a remote backed by the given Supabase client. */
export function createSupabaseRecordRemote(supabase: SupabaseClient): RecordRemote {
  return {
    async upsert(rows: UserRecordRowInput[]): Promise<string[]> {
      // Rows the LWW trigger skipped are not returned.
      const { data, error } = await supabase
        .from(TABLE)
        .upsert(rows, { onConflict: 'id' })
        .select('id');
      if (error) throw toError(error);
      return (data ?? []).map((row: { id: string }) => row.id);
    },

    async fetchByIds(ids: string[]): Promise<UserRecordRow[]> {
      if (ids.length === 0) return [];
      const { data, error } = await supabase.from(TABLE).select(ROW_COLUMNS).in('id', ids);
      if (error) throw toError(error);
      return (data ?? []) as UserRecordRow[];
    },

    async pullPage(kind: string, after: PullCursor | null, limit: number): Promise<UserRecordRow[]> {
      let query = supabase.from(TABLE).select(ROW_COLUMNS).eq('kind', kind);
      if (after) {
        // Keyset: (server_updated_at, id) > (after.ts, after.id).
        query = query.or(
          `server_updated_at.gt."${after.ts}",and(server_updated_at.eq."${after.ts}",id.gt.${after.id})`,
        );
      }
      const { data, error } = await query
        .order('server_updated_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit);
      if (error) throw toError(error);
      return (data ?? []) as UserRecordRow[];
    },
  };
}

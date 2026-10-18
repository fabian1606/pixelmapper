// ── Postgres error → HTTP status ────────────────────────────────────────────
//
// Pure (no Deno/Supabase imports) so it can be unit-tested with
// `bun test supabase/functions/_shared`. The RPCs of migration 009 raise
// these SQLSTATEs on purpose; anything else is a server error.

/** Minimal shape of a PostgREST / supabase-js error. */
export interface DbError {
  code?: string;
  message: string;
}

/** HTTP status for a Postgres SQLSTATE raised by a query or RPC. */
export function statusForDbError(error: DbError | null | undefined): number {
  switch (error?.code) {
    case '28000': return 401; // not authenticated (auth.uid() is null)
    case '42501': return 403; // insufficient privilege / RLS / role check
    case 'P0002': return 404; // no_data_found (e.g. snapshot not found)
    case '22023': // invalid_parameter_value (bad RPC argument)
    case '22P02': return 400; // invalid_text_representation (e.g. bad uuid)
    case '23505': return 409; // unique_violation
    default: return 500;
  }
}

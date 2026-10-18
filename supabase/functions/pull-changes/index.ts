import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, callerRole } from '../_shared/auth.ts';
import { errorResponse, json, preflight, readJsonObject } from '../_shared/http.ts';
import { parsePullChanges } from '../_shared/validate.ts';

// Pulls the change log of a project after a cursor (ADR 0004 §3.2 step 1).
//
// Request:  { projectId, afterSequence, limit? }   (limit default 500, max 1000)
// Response: {
//   changes: [{ sequence_number, change_id, user_id, command_type, payload, created_at }],
//   hasMore,              // more rows after the last returned one (pages may be
//                         // shorter than `limit` when PostgREST max_rows applies)
//   nextAfterSequence,    // cursor for the next page (= last returned seq, or afterSequence)
//   latestSequence,       // highest sequence_number of the project (0 if none)
//   snapshotSequence,     // sequence_number of the latest server snapshot (0 if none)
// }
//
// A client far behind can compare `latestSequence - afterSequence` with the
// snapshot position and reload the snapshot via load-project instead.

const CHANGE_COLUMNS = 'sequence_number, change_id, user_id, command_type, payload, created_at';

Deno.serve(async (req: Request) => {
  const early = preflight(req);
  if (early) return early;

  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;

  const body = await readJsonObject(req);
  if (!body) return errorResponse('invalid JSON body', 400);
  const parsed = parsePullChanges(body);
  if (!parsed.ok) return errorResponse(parsed.error, 400);
  const { projectId, afterSequence, limit } = parsed.value;

  // Explicit access check: RLS alone would silently return an empty log.
  const access = await callerRole(caller, projectId);
  if (access.error) return errorResponse(access.error, 500);
  if (!access.role) return errorResponse('Forbidden', 403);

  // Fetch one extra row to know whether another page exists.
  const [changesRes, latestRes, snapshotRes] = await Promise.all([
    caller.supabase
      .from('project_changes')
      .select(CHANGE_COLUMNS)
      .eq('project_id', projectId)
      .gt('sequence_number', afterSequence)
      .order('sequence_number', { ascending: true })
      .limit(limit + 1),
    caller.supabase
      .from('project_changes')
      .select('sequence_number')
      .eq('project_id', projectId)
      .order('sequence_number', { ascending: false })
      .limit(1)
      .maybeSingle(),
    caller.supabase
      .from('project_snapshots')
      .select('sequence_number')
      .eq('project_id', projectId)
      .order('sequence_number', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const failed = changesRes.error ?? latestRes.error ?? snapshotRes.error;
  if (failed) return errorResponse(failed.message, 500);

  const rows = changesRes.data ?? [];
  const changes = rows.slice(0, limit);
  const last = changes[changes.length - 1];
  const latestSequence = latestRes.data?.sequence_number ?? 0;
  // PostgREST may cap the page below `limit + 1` (db `max_rows`), so the
  // extra row alone is not a reliable signal; compare with the head as well.
  const hasMore = rows.length > limit || (!!last && last.sequence_number < latestSequence);

  return json({
    changes,
    hasMore,
    nextAfterSequence: last ? last.sequence_number : afterSequence,
    latestSequence,
    snapshotSequence: snapshotRes.data?.sequence_number ?? 0,
  });
});

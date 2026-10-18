import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, callerRole } from '../_shared/auth.ts';
import { errorResponse, json, preflight, readJsonObject } from '../_shared/http.ts';

// Loads the latest snapshot plus the change tail after it.
//
// Request:  { projectId }
// Response: {
//   snapshot,          // latest snapshot JSON or null
//   snapshotSequence,  // its sequence_number (0 if none)
//   tail: [{ sequence_number, change_id, user_id, command_type, payload, created_at }],
//   latestSequence,    // highest sequence_number of the project (0 if none)
// }
// The tail is subject to PostgREST `max_rows` (default 1000): if its last
// sequence_number is below `latestSequence`, the client continues with
// pull-changes from there.
// 403 when the caller is not an accepted collaborator.

Deno.serve(async (req: Request) => {
  const early = preflight(req);
  if (early) return early;

  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;

  const body = await readJsonObject(req);
  const projectId = body?.projectId;
  if (typeof projectId !== 'string' || projectId === '') return errorResponse('projectId required', 400);

  // Explicit access check: RLS alone would return an empty project.
  const access = await callerRole(caller, projectId);
  if (access.error) return errorResponse(access.error, 500);
  if (!access.role) return errorResponse('Forbidden', 403);

  // Several snapshots can share a sequence_number (restore-snapshot inserts at
  // the head); the newest one wins.
  const { data: snapRow, error: snapError } = await caller.supabase
    .from('project_snapshots')
    .select('snapshot, sequence_number')
    .eq('project_id', projectId)
    .order('sequence_number', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (snapError) return errorResponse(snapError.message, 500);

  const snapshotSeq = snapRow?.sequence_number ?? 0;

  const { data: tail, error: tailError } = await caller.supabase
    .from('project_changes')
    .select('sequence_number, change_id, user_id, command_type, payload, created_at')
    .eq('project_id', projectId)
    .gt('sequence_number', snapshotSeq)
    .order('sequence_number', { ascending: true });

  if (tailError) return errorResponse(tailError.message, 500);

  const { data: latest, error: latestError } = await caller.supabase
    .from('project_changes')
    .select('sequence_number')
    .eq('project_id', projectId)
    .order('sequence_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) return errorResponse(latestError.message, 500);

  return json({
    snapshot: snapRow?.snapshot ?? null,
    snapshotSequence: snapshotSeq,
    tail: tail ?? [],
    latestSequence: Math.max(latest?.sequence_number ?? 0, snapshotSeq),
  });
});

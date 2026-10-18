import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, callerRole } from '../_shared/auth.ts';
import { errorResponse, json, preflight, readJsonObject } from '../_shared/http.ts';
import { parseSaveSnapshot } from '../_shared/validate.ts';

// Stores a full project snapshot at a sequence position.
//
// Request:  { projectId, snapshot, sequenceNumber, label? }
//           label: optional, ≤ 200 chars, e.g. "before offline sync" (ADR 0004 D5)
// Response: { id, sequence_number, label, created_at }
// 400 for invalid input (non-UUID projectId, or a sequenceNumber above the
// project's latest change); 403 unless the caller is owner or editor.

Deno.serve(async (req: Request) => {
  const early = preflight(req);
  if (early) return early;

  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;

  const body = await readJsonObject(req);
  if (!body) return errorResponse('invalid JSON body', 400);
  const parsed = parseSaveSnapshot(body);
  if (!parsed.ok) return errorResponse(parsed.error, 400);
  const { projectId, snapshot, sequenceNumber, label } = parsed.value;

  // Explicit check so viewers get 403 instead of an RLS error (500).
  const access = await callerRole(caller, projectId);
  if (access.error) return errorResponse(access.error, 500);
  if (access.role !== 'owner' && access.role !== 'editor') return errorResponse('Forbidden', 403);

  // A snapshot claims to reflect every change up to `sequenceNumber`. A
  // position beyond the log's head cannot be true, and load-project would
  // then skip changes committed later below that number.
  const { data: head, error: headError } = await caller.supabase
    .from('project_changes')
    .select('sequence_number')
    .eq('project_id', projectId)
    .order('sequence_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (headError) return errorResponse(headError.message, 500);
  const latestSequence = head?.sequence_number ?? 0;
  if (sequenceNumber > latestSequence) {
    return errorResponse(`sequenceNumber ${sequenceNumber} is beyond the latest change (${latestSequence})`, 400);
  }

  const { data, error } = await caller.supabase
    .from('project_snapshots')
    .insert({
      project_id: projectId,
      snapshot,
      sequence_number: sequenceNumber,
      created_by: caller.user.id,
      label,
    })
    .select('id, sequence_number, label, created_at')
    .single();

  if (error) return errorResponse(error.message, 500);
  return json(data);
});

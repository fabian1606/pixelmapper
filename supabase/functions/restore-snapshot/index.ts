import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { errorResponse, json, preflight, readJsonObject } from '../_shared/http.ts';
import { authenticate } from '../_shared/auth.ts';

// ── restore-snapshot ─────────────────────────────────────────────────────────
// Copies an older snapshot to the head of the change log, so loading the
// project yields that state again. Used by the "Restore state before sync"
// action of the offline-sync conflict toast (ADR 0004 D5).
//
// Request:  { projectId, snapshotId }
// Response: { snapshot, meta: { id, sequence_number, created_at } }
//
// Change vs. the original version: CORS headers + OPTIONS (browser callers)
// and JSON error bodies via the shared helpers; behaviour is unchanged.

Deno.serve(async (req: Request) => {
  const early = preflight(req);
  if (early) return early;

  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;
  const { supabase, user } = caller;

  const body = await readJsonObject(req);
  const projectId = body?.projectId;
  const snapshotId = body?.snapshotId;
  if (typeof projectId !== 'string' || typeof snapshotId !== 'string' || !projectId || !snapshotId) {
    return errorResponse('projectId and snapshotId required', 400);
  }

  // Load the old snapshot (RLS limits this to projects the caller can read).
  const { data: old, error: fetchError } = await supabase
    .from('project_snapshots')
    .select('snapshot, sequence_number')
    .eq('id', snapshotId)
    .eq('project_id', projectId)
    .single();

  if (fetchError || !old) {
    return errorResponse(fetchError?.message ?? 'Snapshot not found', 404);
  }

  // Find the latest sequence_number so the restored snapshot appears at the head
  const { data: latest } = await supabase
    .from('project_changes')
    .select('sequence_number')
    .eq('project_id', projectId)
    .order('sequence_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestSeq = latest?.sequence_number ?? 0;

  const { data: newSnap, error: insertError } = await supabase
    .from('project_snapshots')
    .insert({
      project_id: projectId,
      snapshot: old.snapshot,
      sequence_number: latestSeq,
      created_by: user.id,
      label: `Restored from snapshot ${old.sequence_number}`,
    })
    .select('id, sequence_number, created_at')
    .single();

  if (insertError) {
    return errorResponse(insertError.message, 500);
  }

  return json({ snapshot: old.snapshot, meta: newSnap });
});

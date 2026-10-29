import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate } from '../_shared/auth.ts';
import { errorResponse, json, preflight } from '../_shared/http.ts';

// Lists every project the caller can access (own + shared, accepted only)
// with the sync heads needed for mirroring (ADR 0004 D13).
//
// Request:  {} (POST, body ignored)
// Response: { projects: [{
//   id, name, description, created_at, updated_at,
//   role,                      // caller's role: owner | editor | viewer
//   owner_id,                  // user id of the owner (null if none)
//   latest_sequence,           // highest project_changes.sequence_number (0 if none)
//   latest_change_at,          // created_at of that change (null if none)
//   latest_snapshot_sequence,  // highest project_snapshots.sequence_number (0 if none)
// }] }
//
// `updated_at` only changes on rename; use `latest_sequence` to detect edits.
// Requires migration 007 (`project_sync_heads()`).

Deno.serve(async (req: Request) => {
  const early = preflight(req);
  if (early) return early;

  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;

  // security invoker: RLS restricts the result to the caller's projects.
  const { data, error } = await caller.supabase.rpc('project_sync_heads');
  if (error) return errorResponse(error.message, 500);

  return json({ projects: data ?? [] });
});

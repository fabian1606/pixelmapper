import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, callerRole } from '../_shared/auth.ts';
import { statusForDbError } from '../_shared/db-errors.ts';
import { errorResponse, json, preflight, readJsonObject } from '../_shared/http.ts';
import { parseRestoreSnapshot } from '../_shared/validate.ts';

// ── restore-snapshot ─────────────────────────────────────────────────────────
// Makes an older snapshot the current project state. Used by the "Restore
// state before sync" action of the offline-sync conflict toast (ADR 0004 D5).
//
// Request:  { projectId, snapshotId }
// Response: { snapshot, meta: { id, sequence_number, created_at },
//             markerChangeId, sourceSequence }
//
// Through the `restore_snapshot` RPC (migration 009), in one transaction:
// 1. a marker change `{ command_type: 'restore-snapshot', payload: { snapshotId } }`
//    is appended (serialized like push-change), so collaborators, realtime
//    and the project mirror (`project_sync_heads.latest_sequence`) notice it;
// 2. the restored snapshot is stored AT THE MARKER'S sequence number, so
//    `load-project` starts from it and no older snapshot can win.
// `meta.sequence_number` is the marker's sequence number.
//
// 400 for non-UUID ids, 403 unless owner/editor, 404 for an unknown snapshot.

/** Row returned by `restore_snapshot`. */
interface RestoreRow {
  r_snapshot_id: string;
  r_snapshot: unknown;
  r_sequence: number;
  r_created_at: string;
  r_marker_change_id: string;
  r_source_sequence: number;
}

Deno.serve(async (req: Request) => {
  const early = preflight(req);
  if (early) return early;

  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;

  const parsed = parseRestoreSnapshot(await readJsonObject(req));
  if (!parsed.ok) return errorResponse(parsed.error, 400);
  const { projectId, snapshotId } = parsed.value;

  // Explicit check so viewers get 403 instead of an RLS error (500).
  const access = await callerRole(caller, projectId);
  if (access.error) return errorResponse(access.error, 500);
  if (access.role !== 'owner' && access.role !== 'editor') return errorResponse('Forbidden', 403);

  const { data, error } = await caller.supabase.rpc('restore_snapshot', {
    p_project_id: projectId,
    p_snapshot_id: snapshotId,
  });
  if (error) return errorResponse(error.message, statusForDbError(error));

  const row = (Array.isArray(data) ? data[0] : data) as RestoreRow | undefined;
  if (!row) return errorResponse('restore returned no row', 500);

  return json({
    snapshot: row.r_snapshot,
    meta: { id: row.r_snapshot_id, sequence_number: row.r_sequence, created_at: row.r_created_at },
    markerChangeId: row.r_marker_change_id,
    sourceSequence: row.r_source_sequence,
  });
});

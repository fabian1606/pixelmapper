import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, callerRole } from '../_shared/auth.ts';
import { statusForDbError } from '../_shared/db-errors.ts';
import { errorResponse, json, preflight, readJsonObject } from '../_shared/http.ts';
import {
  type ActivityRow,
  detailRanges,
  parseSnapshotDetails,
  type RestoreMarkerRow,
  type SnapshotPairRow,
  splitPair,
  toSnapshotDetailsResponse,
} from '../_shared/snapshot-details.ts';

// ── snapshot-details ─────────────────────────────────────────────────────────
// "What changed" of one version-history entry (WP-SYNC, migration 012):
// the snapshot, the older snapshot it is compared to (the client diffs the
// two), and the change log between them aggregated per author and command
// type in SQL — raw change payloads are never returned.
//
// Request:  POST { projectId, snapshotId, compareToId? }
// Response: { snapshot: { id, sequenceNumber, label, createdAt, data },
//             previous: same | null,
//             activity: [{ userId, authorName, commandType, count }],
//             restores: [{ sequenceNumber, createdAt, userId, authorName,
//                          snapshotId, sourceSequence, sourceCreatedAt, sourceLabel }],
//             restoredFrom: restore | null }
//
// 400 invalid input, 403 non-collaborators (viewers may read), 404 unknown snapshot.

Deno.serve(async (req: Request) => {
  const early = preflight(req);
  if (early) return early;

  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;

  const parsed = parseSnapshotDetails(await readJsonObject(req));
  if (!parsed.ok) return errorResponse(parsed.error, 400);
  const { projectId, snapshotId, compareToId } = parsed.value;

  // RLS would return nothing; an explicit 403 is clearer for the client.
  const access = await callerRole(caller, projectId);
  if (access.error) return errorResponse(access.error, 500);
  if (!access.role) return errorResponse('Forbidden', 403);

  const pair = await caller.supabase.rpc('snapshot_details_pair', {
    p_project_id: projectId,
    p_snapshot_id: snapshotId,
    p_compare_to_id: compareToId,
  });
  if (pair.error) return errorResponse(pair.error.message, statusForDbError(pair.error));
  const { current, previous } = splitPair((pair.data ?? []) as SnapshotPairRow[]);
  if (!current) return errorResponse('Snapshot not found', 404);

  const ranges = detailRanges(current, previous);
  const [activity, restores] = await Promise.all([
    ranges.activity
      ? caller.supabase.rpc('snapshot_activity', { p_project_id: projectId, p_after_seq: ranges.activity.after, p_upto_seq: ranges.activity.upto })
      : Promise.resolve({ data: [], error: null }),
    caller.supabase.rpc('snapshot_restore_markers', { p_project_id: projectId, p_after_seq: ranges.restores.after, p_upto_seq: ranges.restores.upto }),
  ]);
  if (activity.error) return errorResponse(activity.error.message, statusForDbError(activity.error));
  if (restores.error) return errorResponse(restores.error.message, statusForDbError(restores.error));

  return json(toSnapshotDetailsResponse(
    current,
    previous,
    (activity.data ?? []) as ActivityRow[],
    (restores.data ?? []) as RestoreMarkerRow[],
  ));
});

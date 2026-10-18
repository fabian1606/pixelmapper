import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, callerRole } from '../_shared/auth.ts';
import { statusForDbError } from '../_shared/db-errors.ts';
import { errorResponse, json, preflight, readJsonObject } from '../_shared/http.ts';
import { normalizeLayout, parseSnapshotPreview, type SnapshotPreviewResponse } from '../_shared/snapshot-preview.ts';

// ── snapshot-preview ─────────────────────────────────────────────────────────
// Hover preview of one version-history entry (WP-SYNC, migration 014): a
// compact schematic of the snapshot's scene computed in SQL by
// `snapshot_preview_layout` — the full snapshot JSON is never returned.
//
// Request:  POST { projectId, snapshotId }
// Response: { snapshotId,
//             layout: { fixtures: [[x, y, w, h, r, c, s, b, g], …],
//                       groups: [[name], …], total, truncated } }
//
// 400 invalid input, 403 non-collaborators (viewers may read), 404 unknown snapshot.

Deno.serve(async (req: Request) => {
  const early = preflight(req);
  if (early) return early;

  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;

  const parsed = parseSnapshotPreview(await readJsonObject(req));
  if (!parsed.ok) return errorResponse(parsed.error, 400);
  const { projectId, snapshotId } = parsed.value;

  // RLS would return null; an explicit 403 is clearer for the client.
  const access = await callerRole(caller, projectId);
  if (access.error) return errorResponse(access.error, 500);
  if (!access.role) return errorResponse('Forbidden', 403);

  // Layout of the snapshot (null = not found / not visible).
  const res = await caller.supabase.rpc('snapshot_preview_layout', {
    p_project_id: projectId,
    p_snapshot_id: snapshotId,
  });
  if (res.error) return errorResponse(res.error.message, statusForDbError(res.error));
  const layout = normalizeLayout(res.data);
  if (!layout) return errorResponse('Snapshot not found', 404);

  const body: SnapshotPreviewResponse = { snapshotId, layout };
  return json(body);
});

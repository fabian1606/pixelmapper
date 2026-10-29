import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, callerRole } from '../_shared/auth.ts';
import { statusForDbError } from '../_shared/db-errors.ts';
import { errorResponse, json, preflight, readJsonObject } from '../_shared/http.ts';
import { normalizeHighlights } from '../_shared/snapshot-highlights.ts';
import { normalizeLayout, parseSnapshotPreview, type SnapshotPreviewResponse } from '../_shared/snapshot-preview.ts';

// ── snapshot-preview ─────────────────────────────────────────────────────────
// Hover preview of one version-history entry (WP-SYNC, migrations 014/015):
// a compact schematic of the snapshot's scene (`snapshot_preview_layout`)
// plus "what is special about this version" (`snapshot_preview_highlights`:
// category counts and the payloads of changed entities only, compared with
// `compareToId` or the older list neighbour). Both are computed in SQL — the
// full snapshot JSON is never returned.
//
// Request:  POST { projectId, snapshotId, compareToId? }
// Response: { snapshotId,
//             layout: { fixtures: [[x, y, w, h, r, c, s, b, g], …],
//                       groups: [[name], …], total, truncated },
//             highlights?: { previousId, categories, live, effects, presets,
//                            fixtures, fixtureIndex, settings, truncated } }
//
// `highlights` is omitted (logged) when its RPC fails, e.g. before migration
// 015 is applied — the layout preview keeps working.
// 400 invalid input, 403 non-collaborators (viewers may read), 404 unknown snapshot.

Deno.serve(async (req: Request) => {
  const early = preflight(req);
  if (early) return early;

  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;

  const parsed = parseSnapshotPreview(await readJsonObject(req));
  if (!parsed.ok) return errorResponse(parsed.error, 400);
  const { projectId, snapshotId, compareToId } = parsed.value;

  // RLS would return null; an explicit 403 is clearer for the client.
  const access = await callerRole(caller, projectId);
  if (access.error) return errorResponse(access.error, 500);
  if (!access.role) return errorResponse('Forbidden', 403);

  // Layout (null = not found / not visible) and highlights in parallel.
  const [res, hl] = await Promise.all([
    caller.supabase.rpc('snapshot_preview_layout', {
      p_project_id: projectId,
      p_snapshot_id: snapshotId,
    }),
    caller.supabase.rpc('snapshot_preview_highlights', {
      p_project_id: projectId,
      p_snapshot_id: snapshotId,
      p_compare_to_id: compareToId,
    }),
  ]);
  if (res.error) return errorResponse(res.error.message, statusForDbError(res.error));
  const layout = normalizeLayout(res.data);
  if (!layout) return errorResponse('Snapshot not found', 404);

  const body: SnapshotPreviewResponse = { snapshotId, layout };

  // Highlights are optional: a failure never fails the preview.
  if (hl.error) {
    console.warn('[snapshot-preview] highlights unavailable:', hl.error.message);
  }
  else {
    const highlights = normalizeHighlights(hl.data, layout.fixtures.length);
    if (highlights) body.highlights = highlights;
  }
  return json(body);
});

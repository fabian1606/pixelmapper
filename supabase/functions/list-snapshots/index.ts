import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, callerRole } from '../_shared/auth.ts';
import { statusForDbError } from '../_shared/db-errors.ts';
import { errorResponse, json, preflight, readJsonObject } from '../_shared/http.ts';
import { type SnapshotSummaryRow, toSnapshotListResponse } from '../_shared/snapshot-list.ts';
import { parseListSnapshots } from '../_shared/validate.ts';

// ── list-snapshots ───────────────────────────────────────────────────────────
// One page of a project's server snapshots for the version-history UI
// (ADR 0004 D17), newest first. Never returns the snapshot JSON: the
// summary (fixture/group/modifier counts) is computed in SQL by the
// `list_snapshot_summaries` RPC (migration 010).
//
// Request:  POST { projectId, before?: cursor, limit?: 1…100 (default 30) }
// Response: { snapshots: [{ id, sequenceNumber, label, createdAt, createdBy,
//             authorName, summary: { fixtures, groups, modifiers } }],
//             nextCursor: string | null }
//
// 400 for invalid input, 403 for non-collaborators (any accepted role may read).

Deno.serve(async (req: Request) => {
  const early = preflight(req);
  if (early) return early;

  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;

  const parsed = parseListSnapshots(await readJsonObject(req));
  if (!parsed.ok) return errorResponse(parsed.error, 400);
  const { projectId, limit, before } = parsed.value;

  // RLS would return an empty list; an explicit 403 is clearer for the client.
  const access = await callerRole(caller, projectId);
  if (access.error) return errorResponse(access.error, 500);
  if (!access.role) return errorResponse('Forbidden', 403);

  // One extra row tells whether another page exists.
  const { data, error } = await caller.supabase.rpc('list_snapshot_summaries', {
    p_project_id: projectId,
    p_limit: limit + 1,
    p_before_seq: before?.sequenceNumber ?? null,
    p_before_at: before?.createdAt ?? null,
    p_before_id: before?.id ?? null,
  });
  if (error) return errorResponse(error.message, statusForDbError(error));

  return json(toSnapshotListResponse((data ?? []) as SnapshotSummaryRow[], limit));
});

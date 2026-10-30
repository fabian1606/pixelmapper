import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate } from '../_shared/auth.ts';
import { statusForDbError } from '../_shared/db-errors.ts';
import { errorResponse, json, preflight, readJsonObject } from '../_shared/http.ts';
import { parsePushChanges } from '../_shared/validate.ts';

// ── push-change ──────────────────────────────────────────────────────────────
// Appends changes to the project's change log (ADR 0004 §3.2 step 4.5).
//
// Request:  { projectId, changes: [{ changeId, commandType, payload }] }
//           or the single form { projectId, changeId?, commandType, payload }
// Response: { sequenceNumbers, sequenceNumber, changeIds }  (request order)
//
// Writes go through the `push_changes` RPC (migration 009):
// * idempotent: a change id the caller already pushed returns its stored
//   sequence number (retry after a lost response) instead of failing;
// * a change id stored by ANOTHER user is never acknowledged
//   (`sequenceNumbers[i] = null` → the client keeps it in its outbox);
// * per-project advisory lock: sequence numbers of one project become
//   visible in ascending order, so `pull-changes` (> cursor) cannot skip a
//   change that committed late.
// 401 without token, 400 for invalid input, 403 unless owner/editor.

/** One row returned by `push_changes`. */
interface AckRow {
  idx: number;
  ack_change_id: string;
  ack_sequence: number | null;
}

Deno.serve(async (req: Request) => {
  const early = preflight(req);
  if (early) return early;

  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;

  const body = await readJsonObject(req);
  if (!body) return errorResponse('invalid JSON body', 400);
  const parsed = parsePushChanges(body);
  if (!parsed.ok) return errorResponse(parsed.error, 400);
  const { projectId, changes } = parsed.value;

  if (changes.length === 0) return json({ sequenceNumbers: [], changeIds: [] });

  const { data, error } = await caller.supabase.rpc('push_changes', {
    p_project_id: projectId,
    p_changes: changes,
  });
  if (error) return errorResponse(error.message, statusForDbError(error));

  // The RPC returns one row per request element; match by `idx` to be safe.
  const byIdx = new Map<number, AckRow>();
  for (const row of (data ?? []) as AckRow[]) byIdx.set(row.idx, row);
  const sequenceNumbers = changes.map((_, i) => byIdx.get(i)?.ack_sequence ?? null);
  const changeIds = changes.map(c => c.changeId);

  return json({ sequenceNumbers, sequenceNumber: sequenceNumbers[0], changeIds });
});

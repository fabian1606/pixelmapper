import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { adminClient, authenticate } from '../_shared/auth.ts';
import { errorResponse, json, preflight, readJsonObject } from '../_shared/http.ts';
import { parseCreateProject, type CreateProjectRequest } from '../_shared/validate.ts';

// Creates a project owned by the caller (ADR 0004 D11, D14).
//
// Request:  { name, description?, id?, snapshot?, snapshotLabel? }
// Response: the `projects` row, plus `created` (false when an existing project
//           of the caller was returned) and `snapshot` (meta of the initial
//           snapshot, or null).
//
// With a client id the call is idempotent: if the project already exists and
// the caller owns it, it is returned (and a missing initial snapshot is added)
// instead of failing. An id owned by someone else yields 409.

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

Deno.serve(async (req: Request) => {
  const early = preflight(req);
  if (early) return early;

  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;

  const body = await readJsonObject(req);
  if (!body) return errorResponse('invalid JSON body', 400);
  const parsed = parseCreateProject(body);
  if (!parsed.ok) return errorResponse(parsed.error, 400);
  const input = parsed.value;

  const admin = adminClient();

  // ── Idempotent path: the client id already exists ─────────────────────────
  if (input.id) {
    const existing = await returnExisting(admin, input, caller.user.id);
    if (existing) return existing;
  }

  // ── Insert project ────────────────────────────────────────────────────────
  const { data: project, error: projectError } = await admin
    .from('projects')
    .insert({ ...(input.id ? { id: input.id } : {}), name: input.name, description: input.description })
    .select()
    .single();

  if (projectError) {
    // Lost a race against a concurrent create with the same id → treat like a retry.
    if (projectError.code === UNIQUE_VIOLATION && input.id) {
      const existing = await returnExisting(admin, input, caller.user.id);
      if (existing) return existing;
      return errorResponse('project is being created, retry', 409);
    }
    return errorResponse(projectError.message, 500);
  }

  // ── Owner row + initial snapshot (rolled back on failure) ─────────────────
  const { error: collabError } = await admin
    .from('project_collaborators')
    .insert({
      project_id: project.id,
      user_id: caller.user.id,
      role: 'owner',
      accepted_at: new Date().toISOString(),
    });

  if (collabError) {
    await rollback(admin, project.id);
    return errorResponse(collabError.message, 500);
  }

  let snapshotMeta = null;
  if (input.snapshot) {
    const result = await insertInitialSnapshot(admin, project.id, input, caller.user.id);
    if ('error' in result) {
      await rollback(admin, project.id);
      return errorResponse(result.error, 500);
    }
    snapshotMeta = result.meta;
  }

  return json({ ...project, created: true, snapshot: snapshotMeta });
});

/**
 * Response for a project that already exists under `input.id`:
 * the project (200) if the caller owns it, 409 if it belongs to someone else,
 * `null` if it does not exist.
 */
async function returnExisting(
  admin: SupabaseClient,
  input: CreateProjectRequest,
  userId: string,
): Promise<Response | null> {
  const { data: project, error } = await admin
    .from('projects')
    .select()
    .eq('id', input.id!)
    .maybeSingle();
  if (error) return errorResponse(error.message, 500);
  if (!project) return null;

  const { data: owner } = await admin
    .from('project_collaborators')
    .select('user_id')
    .eq('project_id', project.id)
    .eq('role', 'owner')
    .maybeSingle();
  if (owner?.user_id !== userId) return errorResponse('project id already in use', 409);

  // A previous attempt may have failed between the project insert and the
  // snapshot insert; complete it so the retry has the same effect.
  let snapshotMeta = null;
  if (input.snapshot) {
    const { data: anySnapshot } = await admin
      .from('project_snapshots')
      .select('id')
      .eq('project_id', project.id)
      .limit(1)
      .maybeSingle();
    if (!anySnapshot) {
      const result = await insertInitialSnapshot(admin, project.id, input, userId);
      if ('error' in result) return errorResponse(result.error, 500);
      snapshotMeta = result.meta;
    }
  }

  return json({ ...project, created: false, snapshot: snapshotMeta });
}

/** Stores the uploaded local state as snapshot at sequence 0. */
async function insertInitialSnapshot(
  admin: SupabaseClient,
  projectId: string,
  input: CreateProjectRequest,
  userId: string,
): Promise<{ meta: unknown } | { error: string }> {
  const { data, error } = await admin
    .from('project_snapshots')
    .insert({
      project_id: projectId,
      snapshot: input.snapshot,
      sequence_number: 0,
      created_by: userId,
      label: input.snapshotLabel,
    })
    .select('id, sequence_number, label, created_at')
    .single();
  if (error) return { error: error.message };
  return { meta: data };
}

/** Deletes a half-created project (collaborators/snapshots cascade). */
async function rollback(admin: SupabaseClient, projectId: string): Promise<void> {
  const { error } = await admin.from('projects').delete().eq('id', projectId);
  if (error) console.error('[create-project] rollback failed:', projectId, error.message);
}

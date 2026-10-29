import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { adminClient, authenticate } from '../_shared/auth.ts';
import { planExistingProject } from '../_shared/create-project-plan.ts';
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
// the caller owns it, it is returned instead of failing; a supplied snapshot
// is stored again while the project has no changes (see
// _shared/create-project-plan.ts). An id owned by someone else yields 409; a
// project whose create is still in flight (no owner row yet) yields 503
// (retry); an old orphan created by the caller is adopted.

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
    .insert({
      ...(input.id ? { id: input.id } : {}),
      name: input.name,
      description: input.description,
      // Lets a later retry of this user adopt the project if it stays
      // without an owner row (migration 009).
      created_by: caller.user.id,
    })
    .select()
    .single();

  if (projectError) {
    // Lost a race against a concurrent create with the same id → treat like a retry.
    if (projectError.code === UNIQUE_VIOLATION && input.id) {
      const existing = await returnExisting(admin, input, caller.user.id);
      if (existing) return existing;
      // Deleted again in between (rollback of the concurrent attempt).
      return errorResponse('project is being created, retry', 503);
    }
    return errorResponse(projectError.message, 500);
  }

  // ── Owner row + initial snapshot (rolled back on failure) ─────────────────
  const collabError = await insertOwner(admin, project.id, caller.user.id);

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
 * Response for a project that already exists under `input.id`, or `null` if
 * it does not exist. The decision is `planExistingProject`; this gathers the
 * facts and executes it.
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

  const [collabRes, headRes] = await Promise.all([
    admin.from('project_collaborators').select('user_id, role').eq('project_id', project.id),
    admin.from('project_changes').select('sequence_number').eq('project_id', project.id)
      .order('sequence_number', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const failed = collabRes.error ?? headRes.error;
  if (failed) return errorResponse(failed.message, 500);
  const collaborators = (collabRes.data ?? []) as Array<{ user_id: string; role: string }>;

  const plan = planExistingProject({
    callerId: userId,
    ownerIds: collaborators.filter(c => c.role === 'owner').map(c => c.user_id),
    collaboratorCount: collaborators.length,
    createdBy: (project.created_by as string | null | undefined) ?? null,
    ageMs: Date.now() - Date.parse(project.created_at as string),
    snapshotSupplied: !!input.snapshot,
    headSequence: headRes.data?.sequence_number ?? 0,
  });
  if (plan.kind === 'conflict') return errorResponse(plan.error, 409);
  if (plan.kind === 'retry') return errorResponse(plan.error, 503);

  if (plan.adopt) {
    const adoptError = await insertOwner(admin, project.id, userId);
    if (adoptError) return errorResponse(adoptError.message, 500);
  }

  // Store the CURRENT local state the client sent (a retry may carry newer
  // edits than the first attempt). Newest seq-0 snapshot wins in load-project.
  let snapshotMeta = null;
  if (plan.storeSnapshot) {
    const result = await insertInitialSnapshot(admin, project.id, input, userId);
    if ('error' in result) return errorResponse(result.error, 500);
    snapshotMeta = result.meta;
  }

  return json({ ...project, created: false, snapshot: snapshotMeta });
}

/**
 * Owner row of the caller. `ON CONFLICT DO NOTHING`: a concurrent retry may
 * have adopted the project already (same row), which must not fail the
 * create and trigger its rollback.
 */
async function insertOwner(admin: SupabaseClient, projectId: string, userId: string): Promise<{ message: string } | null> {
  const { error } = await admin
    .from('project_collaborators')
    .upsert({
      project_id: projectId,
      user_id: userId,
      role: 'owner',
      accepted_at: new Date().toISOString(),
    }, { onConflict: 'project_id,user_id', ignoreDuplicates: true });
  return error ? { message: error.message } : null;
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

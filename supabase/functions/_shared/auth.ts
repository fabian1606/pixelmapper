// ── Auth + access helpers shared by the sync edge functions ────────────────
import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2';
import { errorResponse } from './http.ts';

export type ProjectRole = 'owner' | 'editor' | 'viewer';

/** Authenticated caller: a user-scoped client (RLS applies) and the user. */
export interface AuthedCaller {
  supabase: SupabaseClient;
  user: User;
}

/**
 * Verifies the bearer token of the request.
 * Returns the caller, or a 401 response to send back.
 */
export async function authenticate(req: Request): Promise<AuthedCaller | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('Unauthorized', 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return errorResponse('Unauthorized', 401);
  return { supabase, user };
}

/** Service-role client (bypasses RLS). Use only after explicit access checks. */
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

/**
 * Role of the caller in a project (accepted collaborators only).
 * Uses the user-scoped client: RLS lets every user read their own rows.
 * Returns `null` when the caller has no access, or an error message.
 */
export async function callerRole(
  caller: AuthedCaller,
  projectId: string,
): Promise<{ role: ProjectRole | null; error?: string }> {
  const { data, error } = await caller.supabase
    .from('project_collaborators')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', caller.user.id)
    .not('accepted_at', 'is', null)
    .maybeSingle();
  if (error) return { role: null, error: error.message };
  return { role: (data?.role as ProjectRole | undefined) ?? null };
}

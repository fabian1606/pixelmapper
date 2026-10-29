import { readCachedSession } from '~/utils/auth/session-recovery';

/**
 * Id of the signed-in account without a network round-trip (ADR 0004 D10).
 * Uses the user the Supabase module resolved (claims carry `sub`, users
 * `id`), else the session supabase-js persisted. Null when signed out.
 */
export async function resolveCurrentUserId(
  user: { id?: string; sub?: string } | null | undefined,
  auth: unknown,
): Promise<string | null> {
  const direct = user?.id ?? user?.sub;
  if (typeof direct === 'string' && direct) return direct;
  const session = await readCachedSession(auth);
  const id = (session as { user?: { id?: unknown } } | null)?.user?.id;
  return typeof id === 'string' && id ? id : null;
}

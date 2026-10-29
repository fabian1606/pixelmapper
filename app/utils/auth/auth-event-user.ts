import { readCachedSession } from '~/utils/auth/session-recovery';

/**
 * Account behind a Supabase auth event, tolerant of offline boots
 * (ADR 0004 D10: offline never logs out).
 *
 * Offline with an expired access token, auth-js cannot refresh and emits
 * `INITIAL_SESSION` with a null session, while the stored session is kept.
 * Treating that as "signed out" would drop the account (records lose their
 * owner, mirroring never starts). Only a real `SIGNED_OUT` means signed out;
 * every other null session falls back to the persisted session.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** The account an auth event refers to. */
export interface AuthEventUser {
  id: string;
  email: string | null;
}

/** Minimal session shape of an auth event. */
export interface AuthEventSession {
  user?: { id?: string; email?: string | null } | null;
}

// ── Resolution ───────────────────────────────────────────────────────────────

/**
 * Resolve the account for `event`/`session`; `auth` is the Supabase auth
 * client (read without network through `readCachedSession`).
 */
export async function resolveAuthEventUser(
  event: string,
  session: AuthEventSession | null | undefined,
  auth: unknown,
): Promise<AuthEventUser | null> {
  const user = session?.user;
  if (user?.id) return { id: user.id, email: user.email ?? null };
  // A deliberate or server-rejected sign-out: the stored session is gone.
  if (event === 'SIGNED_OUT') return null;
  const cached = await readCachedSession(auth);
  const id = cached?.user?.id;
  return typeof id === 'string' && id ? { id, email: cached?.user?.email ?? null } : null;
}

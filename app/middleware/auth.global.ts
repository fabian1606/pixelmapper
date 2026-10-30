import { getAccountPolicy } from '#platform';
import { hasAuthenticatedUser, readCachedSession, type AuthLike, type CachedSession } from '~/utils/auth/session-recovery';

/**
 * Global auth guard — offline-tolerant (ADR 0004 D10).
 *
 * The decision uses only the locally cached session: the `useSupabaseSession`
 * state (filled by the Supabase plugins, SSR cookies or localStorage) and, on
 * the client, the raw session supabase-js persisted (also when its access
 * token is expired and could not be refreshed offline). On the client and
 * while online, each access token is additionally validated against the auth
 * server once, bounded by a timeout — a network failure never counts as
 * "logged out". Works with `useSsrCookies` on (web) and off (Tauri SPA).
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const supabase = useSupabaseClient();
  const sessionState = useSupabaseSession();

  let signedIn: boolean;
  if (import.meta.server) {
    // SSR (web): the Supabase server plugin already read the cookie session
    // and verified its claims. A session whose claims could not be verified
    // (e.g. transient JWKS/network error) still counts — the edge functions
    // validate every request and a real 401 is handled by the engine store.
    signedIn = !!useSupabaseUser().value || !!sessionState.value;
  }
  else {
    // Local only: state first, then the persisted session.
    let session = sessionState.value as CachedSession | null;
    if (!session) session = await readCachedSession(supabase.auth);
    // Validated against the server once per token while online (bounded).
    signedIn = await hasAuthenticatedUser(session, supabase.auth as unknown as AuthLike, { validate: true });
  }

  if (signedIn && to.path.startsWith('/auth/')) {
    return navigateTo('/');
  }

  // Desktop: the account is optional (ADR 0004 D3) — projects open signed out.
  if (!signedIn && getAccountPolicy().accountRequired && to.path.startsWith('/project/')) {
    return navigateTo(`/auth/login?redirect=${encodeURIComponent(to.fullPath)}`);
  }
});

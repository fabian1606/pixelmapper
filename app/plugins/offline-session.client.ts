import { decodeJwtClaims, readCachedSession, type CachedSession } from '~/utils/auth/session-recovery';
import { isNetworkError, onReconnect, reportNetworkFailure, setConnectivityProbe } from '~/utils/sync/connectivity';

/**
 * Offline session + connectivity bootstrap (ADR 0004 D9/D10). Client only.
 *
 * Runs after the `@nuxtjs/supabase` plugin and patches three offline gaps:
 *
 * 1. **Cached identity.** With an expired access token and no network the
 *    Supabase plugin ends up with `useSupabaseSession() === null` (the refresh
 *    fails, but supabase-js keeps the stored session). The module's own
 *    redirect guard would then send every route to the login page. We restore
 *    the state from the stored session so the user stays signed in offline.
 * 2. **Cached claims.** On every `page:start` the module sets
 *    `useSupabaseUser()` from `getClaims()`, which needs the network once the
 *    token expired (and for JWKS) → null offline. We fall back to the claims
 *    decoded locally from the cached access token.
 * 3. **Refresh on reconnect / reachability probe.** Back online, the session
 *    is refreshed (emits TOKEN_REFRESHED → state updated). A lightweight probe
 *    lets `connectivity.ts` notice when the backend is reachable again even if
 *    the browser never fired an `online` event.
 */
export default defineNuxtPlugin({
  name: 'offline-session',
  dependsOn: ['supabase'],
  async setup(nuxtApp) {
    const supabase = useSupabaseClient();
    const sessionState = useSupabaseSession();
    const userState = useSupabaseUser();
    const runtimeConfig = useRuntimeConfig();

    /** Restore session state + claims from storage when the plugin left them empty. */
    async function restoreFromCache(): Promise<CachedSession | null> {
      const cached = await readCachedSession(supabase.auth);
      if (!cached) return null;
      if (!sessionState.value) sessionState.value = cached as never;
      if (!userState.value) {
        const claims = decodeJwtClaims(cached.access_token);
        if (claims) userState.value = claims as never;
      }
      return cached;
    }

    // (1) Initial state — before the first route middleware runs.
    if (!sessionState.value || !userState.value) await restoreFromCache();

    // (2) The module's page:start hook runs first and may null the user
    // offline; this later hook puts the cached claims back.
    nuxtApp.hook('page:start', async () => {
      if (userState.value) return;
      await restoreFromCache();
    });

    // (3a) Back online: refresh an expired token right away (D10).
    onReconnect(() => {
      supabase.auth.getSession().catch((err: unknown) => {
        if (isNetworkError(err)) reportNetworkFailure();
        console.warn('[auth] session refresh on reconnect failed:', err);
      });
    });

    // (3b) Reachability probe: any HTTP answer from the auth server counts as
    // online (opaque `no-cors` response — status is irrelevant); a thrown
    // fetch means the backend is still unreachable.
    const url = (runtimeConfig.public as { supabase?: { url?: string } }).supabase?.url;
    if (url) {
      setConnectivityProbe(async () => {
        try {
          await fetch(`${url}/auth/v1/health`, { method: 'GET', mode: 'no-cors', cache: 'no-store' });
          return true;
        }
        catch {
          return false;
        }
      });
    }
  },
});

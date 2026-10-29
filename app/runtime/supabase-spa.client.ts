/**
 * Desktop (Tauri, `useSsrCookies: false`) replacement of the `@nuxtjs/supabase`
 * client plugin (ADR 0004 D10, see architecture/offline/wp-p0.md).
 *
 * The module plugin (`@nuxtjs/supabase/dist/runtime/plugins/supabase.client.js`,
 * v2.0.6) `await`s `client.auth.getSession()` in SPA mode. With an expired
 * access token and no network that call retries the refresh for ~30 s (twice:
 * auth-js `_initialize()` + `getSession()`), and Nuxt runs plugins one after
 * another — a blank window for a minute or more. `nuxt.config.ts` swaps the
 * module plugin for this file in desktop builds (hook `app:resolve`).
 *
 * Same contract as the module plugin: name `supabase` (other plugins declare
 * `dependsOn: ['supabase']`), `enforce: 'pre'`, provides `$supabase.client`,
 * fills `useSupabaseSession()`, updates `useSupabaseUser()` from `getClaims()`
 * on `page:start` and follows `onAuthStateChange`. Differences:
 *  - the boot session is resolved by `resolveBootSession` (≤ 3 s, stored
 *    session when offline or slow) instead of an unbounded `getSession()`;
 *  - a missing session/claims only clears state on `SIGNED_OUT` or when
 *    supabase-js no longer stores a session (offline never logs out).
 */
import { createClient } from '@supabase/supabase-js';
import { defineNuxtPlugin, useNuxtApp, useRuntimeConfig, useSupabaseSession, useSupabaseUser } from '#imports';
import { bindAutoRefreshToConnectivity, resolveBootSession, shouldKeepCachedIdentity } from '~/utils/auth/boot-session';
import { fetchWithRetry } from '~/utils/auth/fetch-retry';
import { isOnline } from '~/utils/sync/connectivity';

export default defineNuxtPlugin({
  name: 'supabase',
  enforce: 'pre',
  async setup({ provide }) {
    const nuxtApp = useNuxtApp();
    const { url, key, clientOptions } = useRuntimeConfig().public.supabase;

    // ── Client (identical options to the module's SPA branch) ──────────────
    const client = createClient(url, key, {
      ...clientOptions,
      global: {
        fetch: fetchWithRetry,
        ...clientOptions?.global,
      },
    });
    provide('supabase', { client });

    const currentSession = useSupabaseSession();
    const currentUser = useSupabaseUser();

    // ── Boot session: bounded, never waits for an offline refresh ──────────
    const { session } = await resolveBootSession(client.auth, { online: isOnline.value });
    if (session) currentSession.value = session as never;

    // ── Token refresh ticker only while online (`autoRefreshToken: false`) ──
    if ((clientOptions as { auth?: { autoRefreshToken?: boolean } } | undefined)?.auth?.autoRefreshToken === false) {
      bindAutoRefreshToConnectivity(client.auth, isOnline);
    }

    // ── Claims per navigation (module behaviour + keep cached identity) ─────
    nuxtApp.hook('page:start', async () => {
      const { data } = await client.auth.getClaims();
      if (data?.claims) currentUser.value = data.claims as never;
      else if (!(await shouldKeepCachedIdentity(client.auth))) currentUser.value = null;
    });

    // ── Auth events ────────────────────────────────────────────────────────
    client.auth.onAuthStateChange((event, next) => {
      if (JSON.stringify(currentSession.value) === JSON.stringify(next)) return;
      if (next) {
        currentSession.value = next as never;
        if (next.user) {
          client.auth.getClaims().then(({ data }) => {
            if (data?.claims) currentUser.value = data.claims as never;
          });
        }
        return;
      }
      // No session: INITIAL_SESSION after a failed offline refresh also lands
      // here. The check only reads storage (no auth call → no lock deadlock).
      const before = currentSession.value;
      void shouldKeepCachedIdentity(client.auth, event).then((keep) => {
        // Skip if a newer event changed the state meanwhile.
        if (keep || currentSession.value !== before) return;
        currentSession.value = null;
        currentUser.value = null;
      });
    });
  },
});

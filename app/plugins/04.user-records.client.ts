/**
 * User record sync boot (ADR 0004 D21): installs the Supabase remote and
 * forwards auth state changes, so record collections sync on login.
 * `onAuthStateChange` reads the cached session, so this works offline.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { configureRecordRemote, createSupabaseRecordRemote, setRecordUser } from '~/utils/sync/records';

export default defineNuxtPlugin({
  name: 'pm:user-records',
  setup() {
    try {
      const supabase = useSupabaseClient() as unknown as SupabaseClient;
      configureRecordRemote(createSupabaseRecordRemote(supabase));
      supabase.auth.onAuthStateChange((_event, session) => {
        const userId = session?.user?.id ?? null;
        // Defer: awaiting Supabase calls inside this callback can deadlock the auth client.
        setTimeout(() => {
          setRecordUser(userId).catch(err => console.warn('[user-records] account switch failed:', err));
        }, 0);
      });
    }
    catch (err) {
      // Without Supabase records stay local-only.
      console.warn('[user-records] remote unavailable:', err);
    }
  },
});

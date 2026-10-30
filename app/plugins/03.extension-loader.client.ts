/**
 * Extension host boot step 3 (ADR §5.9): loads the user's installed
 * extension bundles (app catalog + Supabase registry, cached in IndexedDB).
 * Project loading awaits `extensionsReady()` so `requires` can be checked.
 *
 * The account comes from the stored session (no `getSession()` — it blocks
 * boot for ~30 s+ offline with an expired token, ADR 0004 D10).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '~/types/database.types';
import { configureLoader, startLoading } from '~/utils/extensions/loader';
import { resolveLoaderBootConfig } from '~/utils/extensions/boot-config';

export default defineNuxtPlugin({
  name: 'pm:extension-loader',
  async setup() {
    let supabase: SupabaseClient<Database> | null = null;
    try {
      supabase = useSupabaseClient() as unknown as SupabaseClient<Database>;
    }
    catch {
      supabase = null;
    }
    const { sources, installed } = await resolveLoaderBootConfig(supabase, useSupabaseUser().value);
    configureLoader({ sources, installed });
    // Not awaited: the app renders while bundles load; projects wait for them.
    void startLoading();
  },
});

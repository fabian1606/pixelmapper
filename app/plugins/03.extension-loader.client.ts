/**
 * Extension host boot step 3 (ADR §5.9): loads the user's installed
 * extension bundles (app catalog + Supabase registry, cached in IndexedDB).
 * Project loading awaits `extensionsReady()` so `requires` can be checked.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '~/types/database.types';
import { configureLoader, localInstalledStore, startLoading, supabaseInstalledStore } from '~/utils/extensions/loader';
import { catalogSource, registrySource } from '~/utils/extensions/extension-sources';

export default defineNuxtPlugin({
  name: 'pm:extension-loader',
  async setup() {
    let supabase: SupabaseClient<Database> | null = null;
    let userId: string | null = null;
    try {
      supabase = useSupabaseClient() as unknown as SupabaseClient<Database>;
      userId = (await supabase.auth.getSession()).data.session?.user.id ?? null;
    }
    catch {
      supabase = null;
    }
    configureLoader({
      sources: supabase ? [catalogSource(), registrySource(supabase)] : [catalogSource()],
      installed: supabase && userId ? supabaseInstalledStore(supabase, userId) : localInstalledStore(userId),
    });
    // Not awaited: the app renders while bundles load; projects wait for them.
    void startLoading();
  },
});

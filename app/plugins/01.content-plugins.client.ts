/**
 * Content-plugin store boot (ADR §6.10): installs the Supabase remote so
 * unknown plugin hashes (shared projects, live collaboration) resolve
 * through `content_plugins` + the `content-plugins` bucket.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '~/types/database.types';
import { configurePluginStore } from '~/utils/plugins/plugin-store';
import { createSupabaseRemote } from '~/utils/plugins/plugin-remote';

export default defineNuxtPlugin({
  name: 'pm:content-plugins',
  setup() {
    try {
      const supabase = useSupabaseClient() as unknown as SupabaseClient<Database>;
      configurePluginStore({ remote: createSupabaseRemote(supabase) });
    }
    catch (err) {
      // Without Supabase the store still serves built-ins and cached plugins.
      console.warn('[content-plugins] remote registry unavailable:', err);
    }
  },
});

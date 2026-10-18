/**
 * Extension loader configuration at boot (ADR §5.9 step 3, ADR 0004 D10).
 *
 * Kept out of the plugin so it is unit-testable. The account is resolved
 * from the Supabase module state or the stored session — never via
 * `auth.getSession()`, which blocks for ~30 s+ offline with an expired token
 * and then reports no session (→ the anonymous installed list instead of
 * the user's cached one, so a project's required extensions were missing).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '~/types/database.types';
import { resolveCurrentUserId } from '~/utils/sync/current-user';
import { localInstalledStore, supabaseInstalledStore, type InstalledStore } from './loader';
import { catalogSource, registrySource, type ExtensionSource } from './extension-sources';

/** What `configureLoader` needs at boot, plus the resolved account. */
export interface LoaderBootConfig {
  userId: string | null;
  sources: ExtensionSource[];
  installed: InstalledStore;
}

/**
 * Builds the loader configuration without any network wait.
 * @param supabase Supabase client, or null when unavailable.
 * @param user `useSupabaseUser().value` (claims carry `sub`, users `id`).
 */
export async function resolveLoaderBootConfig(
  supabase: SupabaseClient<Database> | null,
  user: { id?: string; sub?: string } | null | undefined,
): Promise<LoaderBootConfig> {
  const userId = supabase ? await resolveCurrentUserId(user, supabase.auth) : null;
  return {
    userId,
    sources: supabase ? [catalogSource(), registrySource(supabase)] : [catalogSource()],
    installed: supabase && userId ? supabaseInstalledStore(supabase, userId) : localInstalledStore(userId),
  };
}

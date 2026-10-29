/**
 * User record sync boot (ADR 0004 D21): installs the Supabase remote and
 * forwards auth state changes, so record collections sync on login.
 * `bindRecordUserToAuth` falls back to the cached session when an offline
 * boot reports no session (D10), so records never lose their owner offline.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { configureRecordRemote, createSupabaseRecordRemote, setRecordUser } from '~/utils/sync/records';
import { bindRecordUserToAuth } from '~/utils/sync/records/record-auth-binding';
import type { RecordAuthSource } from '~/utils/sync/records/record-auth-binding';

export default defineNuxtPlugin({
  name: 'pm:user-records',
  setup() {
    try {
      const supabase = useSupabaseClient() as unknown as SupabaseClient;
      configureRecordRemote(createSupabaseRecordRemote(supabase));
      bindRecordUserToAuth(supabase.auth as unknown as RecordAuthSource, setRecordUser);
    }
    catch (err) {
      // Without Supabase records stay local-only.
      console.warn('[user-records] remote unavailable:', err);
    }
  },
});

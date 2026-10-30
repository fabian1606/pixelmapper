/**
 * Supabase plugin remote offline behaviour (ADR 0004 D10): no data call
 * while offline (each would wait on the expired-token refresh), and the
 * user id comes from the stored session instead of `getUser()`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '~/types/database.types';
import { reportNetworkFailure, reportNetworkSuccess } from '~/utils/sync/connectivity';
import { createSupabaseRemote } from './plugin-remote';

/** Fake client with a stored session; `from`/`getUser` must stay unused. */
function fakeSupabase() {
  const stored = JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: 1, user: { id: 'user-1' } });
  const client = {
    auth: { storageKey: 'k', storage: { getItem: () => stored }, getUser: vi.fn(() => new Promise(() => {})) },
    from: vi.fn(),
    storage: { from: vi.fn() },
  };
  return client as typeof client & SupabaseClient<Database>;
}

afterEach(() => reportNetworkSuccess());

describe('createSupabaseRemote offline', () => {
  it('resolves the user id locally', async () => {
    const supabase = fakeSupabase();
    expect(await createSupabaseRemote(supabase).userId()).toBe('user-1');
    expect(supabase.auth.getUser).not.toHaveBeenCalled();
  });

  it('fails fast offline without touching Supabase', async () => {
    reportNetworkFailure();
    const supabase = fakeSupabase();
    const remote = createSupabaseRemote(supabase);
    await expect(remote.fetch('sha256:a')).rejects.toThrow('offline');
    await expect(remote.list({ mine: true })).rejects.toThrow('offline');
    await expect(remote.findByAlias('x')).rejects.toThrow('offline');
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

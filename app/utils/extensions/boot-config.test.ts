/**
 * Extension loader boot configuration (ADR 0004 D10): offline with an
 * expired token, boot must not await `getSession()` and must load the
 * signed-in user's cached installed list (not the anonymous one).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '~/types/database.types';
import { reportNetworkFailure, reportNetworkSuccess } from '~/utils/sync/connectivity';
import { resolveLoaderBootConfig } from './boot-config';
import { configureLoader, extensionsReady, installedKey, REMOTE_TIMEOUT_MS, startLoading } from './loader';
import { createMemoryBundleCache } from './extension-cache';
import { registrySource } from './extension-sources';

const STORAGE_KEY = 'sb-test-auth-token';
const USER_LIST = [{ id: 'connector-esp', versionRange: '^1.0' }];

/** Never settles (auth refresh retrying offline / request hanging). */
const never = () => new Promise<never>(() => {});

/** Fake Supabase client: stored expired session, hanging auth + data calls. */
function fakeSupabase() {
  const items = new Map([[STORAGE_KEY, JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: 1, user: { id: 'user-1' } })]]);
  // PostgREST builders are thenables; every chain step returns the builder.
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'in', 'delete', 'upsert']) builder[m] = () => builder;
  builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => never().then(res, rej);
  const client = {
    auth: {
      storageKey: STORAGE_KEY,
      storage: { getItem: (k: string) => items.get(k) ?? null },
      getSession: vi.fn(never),
      getUser: vi.fn(never),
    },
    from: vi.fn(() => builder),
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: 'x' } }) }) },
  };
  return client as typeof client & SupabaseClient<Database>;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(installedKey('user-1'), JSON.stringify(USER_LIST));
  localStorage.setItem(installedKey(null), '[]');
});

afterEach(() => {
  reportNetworkSuccess();
  vi.useRealTimers();
});

describe('resolveLoaderBootConfig', () => {
  it('resolves the user from the stored session without awaiting getSession', async () => {
    const supabase = fakeSupabase();
    const cfg = await resolveLoaderBootConfig(supabase, null);
    expect(cfg.userId).toBe('user-1');
    expect(supabase.auth.getSession).not.toHaveBeenCalled();
    expect(supabase.auth.getUser).not.toHaveBeenCalled();
  });

  it('prefers the module user (claims `sub`)', async () => {
    const cfg = await resolveLoaderBootConfig(fakeSupabase(), { sub: 'user-2' });
    expect(cfg.userId).toBe('user-2');
  });

  it('offline: picks the user\'s cached installed list, not the anonymous one, with no request', async () => {
    reportNetworkFailure();
    const supabase = fakeSupabase();
    const cfg = await resolveLoaderBootConfig(supabase, null);
    expect(await cfg.installed.list()).toEqual(USER_LIST);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('online but the backend hangs: falls back to the mirror after the timeout', async () => {
    vi.useFakeTimers();
    const cfg = await resolveLoaderBootConfig(fakeSupabase(), null);
    const list = cfg.installed.list();
    await vi.advanceTimersByTimeAsync(REMOTE_TIMEOUT_MS + 1);
    expect(await list).toEqual(USER_LIST);
  });

  it('without a client: anonymous local list', async () => {
    const cfg = await resolveLoaderBootConfig(null, null);
    expect(cfg.userId).toBeNull();
    expect(await cfg.installed.list()).toEqual([]);
  });
});

describe('boot loading with a hanging registry', () => {
  it('extensionsReady settles (missing bundle) after one bounded listing', async () => {
    vi.useFakeTimers();
    const supabase = fakeSupabase();
    const cfg = await resolveLoaderBootConfig(supabase, null);
    // Registry only (the catalog would fetch /extensions over the test network).
    configureLoader({ cache: createMemoryBundleCache(), sources: [registrySource(supabase)], installed: cfg.installed });
    void startLoading();
    // installed list timeout + one shared source listing timeout.
    await vi.advanceTimersByTimeAsync(3 * REMOTE_TIMEOUT_MS);
    const results = await extensionsReady();
    expect(results.map(r => [r.id, r.status])).toEqual([['connector-esp', 'missing']]);
  });

  it('offline: the registry source fails fast without touching Supabase', async () => {
    reportNetworkFailure();
    const supabase = fakeSupabase();
    await expect(registrySource(supabase).list()).rejects.toThrow('offline');
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

/**
 * Boot session resolution (ADR 0004 D10): app start must never wait for an
 * offline token refresh (`getSession()` retries ~30 s with an expired token).
 */
import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { bindAutoRefreshToConnectivity, resolveBootSession, shouldKeepCachedIdentity, type BootAuthLike } from './boot-session';

const STORAGE_KEY = 'sb-test-auth-token';

/** Stored session with an expired access token. */
const EXPIRED = { access_token: 'tok', refresh_token: 'r', expires_at: 1, user: { id: 'user-1' } };

/** Fake auth client: storage + a controllable `getSession`. */
function fakeAuth(getSession: BootAuthLike['getSession'], stored: unknown = EXPIRED) {
  const items = new Map<string, string>();
  if (stored) items.set(STORAGE_KEY, JSON.stringify(stored));
  return {
    storageKey: STORAGE_KEY,
    storage: { getItem: (k: string) => items.get(k) ?? null },
    getSession: vi.fn(getSession),
  };
}

/** A promise that never settles (offline refresh still retrying). */
const never = <T>() => new Promise<T>(() => {});

describe('resolveBootSession', () => {
  it('offline: returns the stored session without calling getSession', async () => {
    const auth = fakeAuth(never);
    const res = await resolveBootSession(auth, { online: false });
    expect(res).toEqual({ session: EXPIRED, source: 'cache' });
    expect(auth.getSession).not.toHaveBeenCalled();
  });

  it('online but getSession hangs: falls back to the stored session after the timeout', async () => {
    const auth = fakeAuth(never);
    const t0 = Date.now();
    const res = await resolveBootSession(auth, { online: true, timeoutMs: 20 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(res.source).toBe('cache');
    expect(res.session?.user?.id).toBe('user-1');
  });

  it('online and slow rejection: uses the cache and swallows the late rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const auth = fakeAuth(() => new Promise((_, reject) => setTimeout(() => reject(new Error('Failed to fetch')), 40)));
    const res = await resolveBootSession(auth, { online: true, timeoutMs: 10 });
    expect(res.source).toBe('cache');
    await new Promise(r => setTimeout(r, 60));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('online and fast: keeps the module behaviour (fresh session from getSession)', async () => {
    const fresh = { ...EXPIRED, access_token: 'fresh', expires_at: 9e9 };
    const auth = fakeAuth(async () => ({ data: { session: fresh }, error: null }));
    expect(await resolveBootSession(auth, { online: true })).toEqual({ session: fresh, source: 'network' });
  });

  it('refresh failed with a retryable error: keeps the stored identity', async () => {
    const err = Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError' });
    const auth = fakeAuth(async () => ({ data: { session: null }, error: err }));
    expect((await resolveBootSession(auth, { online: true })).source).toBe('cache');
  });

  it('no session and no error: signed out', async () => {
    const auth = fakeAuth(async () => ({ data: { session: null }, error: null }), null);
    expect(await resolveBootSession(auth, { online: true })).toEqual({ session: null, source: 'none' });
  });
});

describe('shouldKeepCachedIdentity', () => {
  it('keeps the identity unless signed out or nothing is stored', async () => {
    expect(await shouldKeepCachedIdentity(fakeAuth(never), 'INITIAL_SESSION')).toBe(true);
    expect(await shouldKeepCachedIdentity(fakeAuth(never))).toBe(true);
    expect(await shouldKeepCachedIdentity(fakeAuth(never), 'SIGNED_OUT')).toBe(false);
    expect(await shouldKeepCachedIdentity(fakeAuth(never, null), 'INITIAL_SESSION')).toBe(false);
  });
});

describe('bindAutoRefreshToConnectivity', () => {
  it('runs the refresh ticker only while online', async () => {
    const auth = { startAutoRefresh: vi.fn(async () => {}), stopAutoRefresh: vi.fn(async () => {}) };
    const online = ref(false);
    const stop = bindAutoRefreshToConnectivity(auth, online);
    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(auth.startAutoRefresh).not.toHaveBeenCalled();
    online.value = true;
    await nextTick();
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
    online.value = false;
    await nextTick();
    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(2);
    stop();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthLike, CachedSession } from '~/utils/auth/session-recovery';

type Recovery = typeof import('~/utils/auth/session-recovery');
type Connectivity = typeof import('~/utils/sync/connectivity');

let rec: Recovery;
let conn: Connectivity;

beforeEach(async () => {
  // Fresh connectivity + validation cache per test.
  vi.resetModules();
  conn = await import('~/utils/sync/connectivity');
  rec = await import('~/utils/auth/session-recovery');
  conn.reportNetworkSuccess();
});

/** Unsigned JWT with the given claims (signature irrelevant for local decoding). */
function jwt(claims: Record<string, unknown>): string {
  // UTF-8 bytes → base64url, like a real JWT.
  const b64 = (o: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64(claims)}.sig`;
}

/** Session that expires `inSec` seconds from now. */
function session(inSec: number, token = jwt({ sub: 'user-1', email: 'ü@x.de' })): CachedSession {
  return { access_token: token, refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + inSec };
}

/** Auth client stub. */
function auth(over: Partial<AuthLike>): AuthLike {
  return {
    refreshSession: vi.fn(async () => ({ data: { session: {} }, error: null })),
    getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
    ...over,
  };
}

const RETRYABLE = Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 });
const INVALID = Object.assign(new Error('Invalid Refresh Token'), { name: 'AuthApiError', status: 400 });

describe('readCachedSession', () => {
  it('reads the stored session without network, even when expired', async () => {
    const stored = session(-3600);
    const a = { storageKey: 'sb-x-auth-token', storage: { getItem: async () => JSON.stringify(stored) } };
    expect(await rec.readCachedSession(a)).toEqual(stored);
  });

  it('returns null for missing/garbage storage', async () => {
    expect(await rec.readCachedSession({})).toBeNull();
    expect(await rec.readCachedSession({ storageKey: 'k', storage: { getItem: () => '{nope' } })).toBeNull();
    expect(await rec.readCachedSession({ storageKey: 'k', storage: { getItem: () => null } })).toBeNull();
  });
});

describe('decodeJwtClaims', () => {
  it('decodes base64url payloads including UTF-8', () => {
    expect(rec.decodeJwtClaims(jwt({ sub: 'u', email: 'ü@x.de' }))).toEqual({ sub: 'u', email: 'ü@x.de' });
    expect(rec.decodeJwtClaims('not-a-jwt')).toBeNull();
  });
});

describe('resolveUnauthorized (401 handling)', () => {
  it('keeps the session while offline without calling the server', async () => {
    conn.reportNetworkFailure();
    const a = auth({});
    expect(await rec.resolveUnauthorized(a)).toBe('keep');
    expect(a.refreshSession).not.toHaveBeenCalled();
  });

  it('retries after a successful refresh', async () => {
    expect(await rec.resolveUnauthorized(auth({}))).toBe('retry');
  });

  it('keeps the session on network/transient refresh errors', async () => {
    const a = auth({ refreshSession: async () => ({ data: { session: null }, error: RETRYABLE }) });
    expect(await rec.resolveUnauthorized(a)).toBe('keep');
  });

  it('signs out only when the refresh is definitively rejected', async () => {
    const a = auth({ refreshSession: async () => ({ data: { session: null }, error: INVALID }) });
    expect(await rec.resolveUnauthorized(a)).toBe('sign-out');
  });
});

describe('hasAuthenticatedUser (route guard)', () => {
  it('is false without a cached session', async () => {
    expect(await rec.hasAuthenticatedUser(null, auth({}), { validate: true })).toBe(false);
  });

  it('trusts a cached session offline — even an expired one — without network', async () => {
    conn.reportNetworkFailure();
    const a = auth({});
    expect(await rec.hasAuthenticatedUser(session(-3600), a, { validate: true })).toBe(true);
    expect(a.getUser).not.toHaveBeenCalled();
  });

  it('validates once per token when online and caches the result', async () => {
    const a = auth({});
    const s = session(3600);
    expect(await rec.hasAuthenticatedUser(s, a, { validate: true })).toBe(true);
    expect(await rec.hasAuthenticatedUser(s, a, { validate: true })).toBe(true);
    expect(a.getUser).toHaveBeenCalledTimes(1);
  });

  it('treats a definitive server rejection as signed out', async () => {
    const a = auth({ getUser: async () => ({ data: { user: null }, error: Object.assign(new Error('bad jwt'), { name: 'AuthApiError', status: 403 }) }) });
    expect(await rec.hasAuthenticatedUser(session(3600), a, { validate: true })).toBe(false);
  });

  it('keeps the cached identity when validation fails on the network', async () => {
    const a = auth({ getUser: async () => ({ data: { user: null }, error: RETRYABLE }) });
    expect(await rec.hasAuthenticatedUser(session(3600), a, { validate: true })).toBe(true);
    expect(conn.isOnline.value).toBe(false);
  });

  it('does not block navigation longer than the timeout', async () => {
    vi.useFakeTimers();
    const a = auth({ getUser: () => new Promise(() => {}) });
    const p = rec.hasAuthenticatedUser(session(3600), a, { validate: true, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toBe(true);
    vi.useRealTimers();
  });
});

/**
 * Offline-tolerant session handling (ADR 0004 D10: offline never logs out).
 *
 * Pure helpers on top of the Supabase auth client — no Nuxt imports, so they
 * are unit-testable and usable from stores, middleware and plugins alike.
 */
import { isNetworkError, isOnline, reportNetworkFailure, reportNetworkSuccess } from '~/utils/sync/connectivity';

// ── Types ────────────────────────────────────────────────────────────────────

/** Minimal shape of a stored Supabase session that we rely on. */
export interface CachedSession {
  access_token: string;
  refresh_token?: string;
  /** Seconds since epoch. */
  expires_at?: number;
  user?: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null;
}

/** Subset of `SupabaseClient['auth']` used here (keeps tests free of supabase-js). */
export interface AuthLike {
  refreshSession(): Promise<{ data: { session: unknown } | null; error: unknown }>;
  getUser(jwt?: string): Promise<{ data: { user: unknown } | null; error: unknown }>;
}

/** What to do after a backend request answered 401. */
export type UnauthorizedAction = 'retry' | 'keep' | 'sign-out';

// ── Error classification ─────────────────────────────────────────────────────

/**
 * True for auth errors that say nothing about the session's validity:
 * network failures and retryable gateway errors (supabase-js reports both as
 * `AuthRetryableFetchError`), plus 5xx responses.
 */
export function isTransientAuthError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; status?: number };
  if (e.name === 'AuthRetryableFetchError') return true;
  if (typeof e.status === 'number' && e.status >= 500) return true;
  return isNetworkError(err);
}

// ── Cached session ───────────────────────────────────────────────────────────

/**
 * Read the session supabase-js persisted (localStorage in SPA/Tauri mode,
 * cookies in SSR mode) WITHOUT any network call — even if the access token is
 * expired. Returns null if nothing usable is stored.
 */
export async function readCachedSession(auth: unknown): Promise<CachedSession | null> {
  try {
    // `storage` and `storageKey` are protected in the typings but public at runtime.
    const a = auth as { storage?: { getItem(k: string): unknown }; storageKey?: string };
    if (!a?.storage || !a.storageKey) return null;
    const raw = await a.storage.getItem(a.storageKey);
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    // Older auth-js versions nested the session under `currentSession`.
    const session = (parsed?.currentSession ?? parsed) as CachedSession | null;
    return session && typeof session.access_token === 'string' ? session : null;
  }
  catch (err) {
    console.warn('[auth] reading cached session failed:', err);
    return null;
  }
}

/** True if the session's access token is expired (or expires within `skewSec`). */
export function isSessionExpired(session: CachedSession, skewSec = 10, nowMs = Date.now()): boolean {
  if (typeof session.expires_at !== 'number') return false;
  return session.expires_at * 1000 <= nowMs + skewSec * 1000;
}

/**
 * Decode the claims of a JWT locally (no signature check — only used to show
 * the cached identity while offline; the server still validates every call).
 */
export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const json = decodeURIComponent(
      Array.from(atob(b64), c => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
    );
    const claims = JSON.parse(json);
    return claims && typeof claims === 'object' ? claims : null;
  }
  catch {
    return null;
  }
}

// ── 401 handling ─────────────────────────────────────────────────────────────

/**
 * Decide how to react to a 401 from the backend. A 401 can simply mean the
 * access token expired while we could not refresh it (offline period), so we
 * try a refresh first and only sign out when the refresh itself is rejected
 * by the auth server. Offline or on transient errors the session is kept.
 */
export async function resolveUnauthorized(auth: AuthLike): Promise<UnauthorizedAction> {
  if (!isOnline.value) return 'keep';
  try {
    const { data, error } = await auth.refreshSession();
    if (!error && data?.session) {
      reportNetworkSuccess();
      return 'retry';
    }
    if (isTransientAuthError(error)) {
      if (isNetworkError(error)) reportNetworkFailure();
      return 'keep';
    }
    return 'sign-out';
  }
  catch (err) {
    // refreshSession normally returns errors; a throw is treated as transient.
    console.warn('[auth] refresh after 401 failed:', err);
    if (isNetworkError(err)) reportNetworkFailure();
    return 'keep';
  }
}

// ── Route guard decision ─────────────────────────────────────────────────────

/** Validation result cache: access token → still valid on the server. */
const validatedTokens = new Map<string, boolean>();

/** Max time a guard waits for the optional server check before trusting the cache. */
export const AUTH_VALIDATION_TIMEOUT_MS = 3000;

/**
 * Decide whether the route guard should treat the user as signed in, using
 * only the locally cached session. When online, each access token is checked
 * against the server ONCE (bounded by a timeout); a definitive rejection
 * makes the user anonymous, while a network failure/timeout keeps the cached
 * identity (D10: route guards never require a network round-trip).
 */
export async function hasAuthenticatedUser(
  session: CachedSession | null,
  auth: AuthLike | null,
  opts: { validate?: boolean; timeoutMs?: number } = {},
): Promise<boolean> {
  if (!session?.access_token) return false;
  // Offline, expired or no validation wanted → trust the cache.
  if (!opts.validate || !auth || !isOnline.value || isSessionExpired(session)) return true;

  const token = session.access_token;
  const known = validatedTokens.get(token);
  if (known != null) return known;

  const timeoutMs = opts.timeoutMs ?? AUTH_VALIDATION_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs); });
  try {
    const result = await Promise.race([auth.getUser(token), timeout]);
    if (result === 'timeout') return true; // slow network: don't block, don't cache
    const { data, error } = result;
    if (error) {
      if (isTransientAuthError(error)) {
        if (isNetworkError(error)) reportNetworkFailure();
        return true;
      }
      validatedTokens.set(token, false);
      return false;
    }
    reportNetworkSuccess();
    const ok = !!data?.user;
    validatedTokens.set(token, ok);
    return ok;
  }
  catch (err) {
    if (isNetworkError(err)) reportNetworkFailure();
    return true;
  }
  finally {
    if (timer != null) clearTimeout(timer);
  }
}

/** Test helper: forget all cached validation results. */
export function resetAuthValidationCache(): void {
  validatedTokens.clear();
}

/**
 * Non-blocking session resolution for app boot (ADR 0004 D10).
 *
 * `supabase.auth.getSession()` refreshes an expired access token before it
 * resolves. Offline, auth-js retries that refresh with exponential backoff
 * for up to one auto-refresh tick (30 s) — once in `_initialize()` and again
 * in `getSession()` — and every attempt goes through the module's 3× fetch
 * retry. Awaiting it in a Nuxt plugin therefore blocks the whole app start
 * for a minute or more. Boot code uses these helpers instead: they never
 * wait longer than a short timeout and fall back to the stored session.
 *
 * Pure (no Nuxt imports) so the decisions are unit-testable.
 */
import { watch, type Ref, type WatchStopHandle } from 'vue';
import { readCachedSession, type CachedSession } from '~/utils/auth/session-recovery';

// ── Types ────────────────────────────────────────────────────────────────────

/** Subset of the Supabase auth client used at boot. */
export interface BootAuthLike {
  getSession(): Promise<{ data: { session: unknown } | null; error?: unknown }>;
}

/** Where the boot session came from. */
export type BootSessionSource = 'network' | 'cache' | 'none';

/** Result of {@link resolveBootSession}. */
export interface BootSession {
  session: CachedSession | null;
  source: BootSessionSource;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Max time boot waits for `getSession()` before trusting the stored session. */
export const BOOT_SESSION_TIMEOUT_MS = 3000;

// ── Resolution ───────────────────────────────────────────────────────────────

/**
 * Resolve the session for boot without blocking on the network.
 *
 * - Offline: the stored session is returned right away (no `getSession()`).
 * - Online: `getSession()` is raced against `timeoutMs`. A fresh session wins
 *   (same behaviour as the module plugin for online boots). On timeout, a
 *   throw or a refresh error the stored session is used; the pending
 *   `getSession()` keeps running and later updates state via
 *   `onAuthStateChange` (TOKEN_REFRESHED).
 * - `getSession()` resolving to "no session" without an error means signed out.
 */
export async function resolveBootSession(
  auth: BootAuthLike,
  opts: { online: boolean; timeoutMs?: number },
): Promise<BootSession> {
  const fromCache = async (): Promise<BootSession> => {
    const session = await readCachedSession(auth);
    return { session, source: session ? 'cache' : 'none' };
  };
  if (!opts.online) return fromCache();

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), opts.timeoutMs ?? BOOT_SESSION_TIMEOUT_MS);
  });
  const pending = auth.getSession();
  // The race may be lost: keep a late rejection from becoming unhandled.
  pending.catch((err: unknown) => console.warn('[auth] background getSession failed:', err));
  try {
    const result = await Promise.race([pending, timeout]);
    if (result === 'timeout') return fromCache();
    const session = (result.data?.session ?? null) as CachedSession | null;
    if (session) return { session, source: 'network' };
    // Refresh failed (e.g. retryable network error): auth-js keeps the stored session.
    if (result.error) return fromCache();
    return { session: null, source: 'none' };
  }
  catch (err) {
    console.warn('[auth] getSession at boot failed, using the stored session:', err);
    return fromCache();
  }
  finally {
    if (timer != null) clearTimeout(timer);
  }
}

/**
 * True if the cached identity must be kept although auth reported no
 * session/claims: anything but an explicit `SIGNED_OUT` while supabase-js
 * still holds a stored session (it only deletes it on sign-out or when the
 * auth server rejects the refresh token). Offline never logs out (D10).
 */
export async function shouldKeepCachedIdentity(auth: unknown, event?: string): Promise<boolean> {
  if (event === 'SIGNED_OUT') return false;
  return (await readCachedSession(auth)) != null;
}

// ── Auto refresh bound to connectivity ───────────────────────────────────────

/** Subset of the auth client controlling the refresh ticker. */
export interface AutoRefreshLike {
  startAutoRefresh(): Promise<void>;
  stopAutoRefresh(): Promise<void>;
}

/**
 * Run supabase-js's token refresh ticker only while online (desktop sets
 * `autoRefreshToken: false`, so neither `_initialize()` nor visibility
 * changes start it). Offline a tick with an expired token would hold the
 * auth lock for ~30 s of refresh retries, stalling every `getSession()`.
 * Back online the ticker restarts and refreshes within one tick (30 s);
 * `getSession()` still refreshes lazily in between. Returns a stop handle.
 */
export function bindAutoRefreshToConnectivity(auth: AutoRefreshLike, online: Readonly<Ref<boolean>>): WatchStopHandle {
  return watch(online, (on) => {
    const op = on ? auth.startAutoRefresh() : auth.stopAutoRefresh();
    op.catch((err: unknown) => console.warn('[auth] toggling auto refresh failed:', err));
  }, { immediate: true });
}

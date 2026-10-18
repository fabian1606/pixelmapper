/**
 * Forwards Supabase auth events to the record sync's account
 * (`setRecordUser`), tolerant of offline boots (ADR 0004 D10, D21).
 *
 * Offline with an expired access token auth-js emits `INITIAL_SESSION` with
 * a null session although the session is still stored. Forwarding `null`
 * would make every record saved afterwards local-only (`ownerUserId: null`):
 * never uploaded, and deleted by a web logout. `resolveAuthEventUser` falls
 * back to the cached session, so only a real `SIGNED_OUT` reports `null`.
 */
import { resolveAuthEventUser } from '~/utils/auth/auth-event-user';
import type { AuthEventSession } from '~/utils/auth/auth-event-user';

// ── Types ────────────────────────────────────────────────────────────────────

/** The part of `supabase.auth` used here (its storage is read by `readCachedSession`). */
export interface RecordAuthSource {
  onAuthStateChange(callback: (event: string, session: AuthEventSession | null) => void): unknown;
}

/** Receives the resolved account id (`setRecordUser` in the app). */
export type RecordUserSink = (userId: string | null) => Promise<void>;

// ── Binding ──────────────────────────────────────────────────────────────────

/**
 * Subscribes to `auth` and reports every event's account to `setUser`.
 * Events are handled one after another in arrival order (resolving the
 * cached session is async, so an older event must not overtake a newer one).
 * Returns a function resolving once every event seen so far is handled.
 */
export function bindRecordUserToAuth(auth: RecordAuthSource, setUser: RecordUserSink): () => Promise<void> {
  let queue: Promise<void> = Promise.resolve();

  auth.onAuthStateChange((event, session) => {
    // Defer: awaiting Supabase calls inside this callback can deadlock the auth client.
    const deferred = new Promise<void>(resolve => setTimeout(resolve, 0));
    queue = queue
      .then(() => deferred)
      .then(async () => {
        const user = await resolveAuthEventUser(event, session, auth);
        await setUser(user?.id ?? null);
      })
      .catch(err => console.warn('[user-records] account switch failed:', err));
  });

  return () => queue;
}

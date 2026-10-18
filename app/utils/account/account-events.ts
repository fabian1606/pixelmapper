import type { AccountIdentity } from '~/utils/account/known-accounts';
import type { LoginTracker } from '~/utils/account/login-transition';
import { resolveAuthEventUser, type AuthEventSession } from '~/utils/auth/auth-event-user';
import { setCurrentAccountId } from '~/utils/auth/current-account';

/**
 * Account reactions to Supabase auth events (ADR 0004 D10, D13–D16), free of
 * Nuxt so they can be tested with fake events. Used by `05.account.client.ts`.
 *
 * - The signed-in account is published synchronously (`current-account`)
 *   when the event says so, so a sync engine bound to another account stops
 *   before its next request.
 * - Offline boots with an expired token emit `INITIAL_SESSION` without a
 *   session: the account comes from the cached session, it is NOT a sign-out.
 * - `SIGNED_OUT` or a switch to another account ends everything running for
 *   the previous one: mirroring and the open project's session.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface AccountEventDeps {
  /** Supabase auth client (cached session fallback, no network). */
  auth: unknown;
  tracker: LoginTracker;
  rememberAccount(account: AccountIdentity): void;
  /** A real sign-in (not a refresh or restored session). */
  onSignedIn(account: AccountIdentity): void | Promise<void>;
  /** Start/restart (id) or stop (null) mirroring. */
  setMirrorUser(userId: string | null): void;
  /** Close the open project's sync session. */
  closeOpenProject(): Promise<void>;
  /** Signed out (clear pending dialogs etc.). */
  onSignedOut?(): void;
}

export interface AccountEventHandler {
  /**
   * Publish the account an event names, synchronously and without any
   * Supabase call (safe inside the auth callback).
   */
  note(event: string, session: AuthEventSession | null | undefined): void;
  /** Feed one auth event; resolves when its reactions ran. */
  handle(event: string, session: AuthEventSession | null | undefined): Promise<void>;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export function createAccountEventHandler(deps: AccountEventDeps): AccountEventHandler {
  /** Events are handled one after another (async cache reads in between). */
  let chain: Promise<void> = Promise.resolve();
  /** Account of the last handled event (`undefined` before the first). */
  let lastAccount: string | null | undefined;

  /** Reactions to one event. */
  async function run(event: string, session: AuthEventSession | null | undefined): Promise<void> {
    const previous = lastAccount;
    const user = await resolveAuthEventUser(event, session, deps.auth);
    const account: AccountIdentity | null = user ? { id: user.id, label: user.email } : null;
    lastAccount = account?.id ?? null;
    setCurrentAccountId(lastAccount);

    // Signed out, or another account took over this tab: nothing may keep
    // running for the previous account.
    const switched = previous != null && previous !== (account?.id ?? null);
    if (event === 'SIGNED_OUT' || switched) {
      deps.setMirrorUser(null);
      await deps.closeOpenProject();
    }
    if (event === 'SIGNED_OUT') {
      deps.tracker.observe(event, null);
      deps.onSignedOut?.();
      return;
    }
    if (!account) return;
    deps.rememberAccount(account);
    if (deps.tracker.observe(event, account.id)) await deps.onSignedIn(account);
    deps.setMirrorUser(account.id);
  }

  /** Publish what the event itself says (null sessions need the cache). */
  function note(event: string, session: AuthEventSession | null | undefined): void {
    if (event === 'SIGNED_OUT') setCurrentAccountId(null);
    else if (session?.user?.id) setCurrentAccountId(session.user.id);
  }

  return {
    note,
    handle(event, session) {
      note(event, session);
      const run$ = chain.then(() => run(event, session)).catch((err: unknown) => {
        console.warn('[account] handling the auth event failed:', err);
      });
      chain = run$;
      return run$;
    },
  };
}

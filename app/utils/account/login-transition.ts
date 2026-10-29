/**
 * Detects real sign-ins (ADR 0004 D14) from Supabase auth events.
 *
 * `SIGNED_IN` is also emitted for session recovery and refreshes, so the
 * event name alone does not mean "the user just logged in". Instead the last
 * account seen on this device is persisted: a session for a different
 * account than the last one (or after an explicit sign-out) is a sign-in.
 * A missing session at startup (expired token offline) is not a sign-out —
 * only the `SIGNED_OUT` event clears the record.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Minimal key/value storage (localStorage in the app, a map in tests). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LoginTracker {
  /**
   * Feeds an auth event. Returns the account id when the event is a sign-in
   * transition, otherwise `null`.
   */
  observe(event: string, userId: string | null): string | null;
}

const STORAGE_KEY = 'pm:account:last-user';

// ── Implementation ───────────────────────────────────────────────────────────

/** Creates a tracker on top of `storage` (falls back to memory if it throws). */
export function createLoginTracker(storage: KeyValueStorage | null): LoginTracker {
  let memory: string | null = null;

  /** Last account seen on this device. */
  const read = (): string | null => {
    try { return storage ? storage.getItem(STORAGE_KEY) : memory; }
    catch { return memory; }
  };

  /** Persists the last account (`null` = signed out). */
  const write = (value: string | null): void => {
    memory = value;
    try {
      if (!storage) return;
      if (value === null) storage.removeItem(STORAGE_KEY);
      else storage.setItem(STORAGE_KEY, value);
    }
    catch (err) {
      console.warn('[account] could not persist last account:', err);
    }
  };

  return {
    observe(event, userId) {
      if (event === 'SIGNED_OUT') {
        write(null);
        return null;
      }
      if (!userId) return null;
      const previous = read();
      if (previous === userId) return null;
      write(userId);
      return userId;
    },
  };
}

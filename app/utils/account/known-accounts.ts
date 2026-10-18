/**
 * Display labels of accounts that signed in on this device (ADR 0004 D15).
 *
 * Kept projects stay bound to `ownerUserId`; the "Owned by …" badge needs a
 * human-readable name for that id even while another account (or nobody) is
 * signed in. The map is a per-device convenience in localStorage: if it is
 * unavailable the badge falls back to "another account".
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** The signed-in account as seen by the account flows. */
export interface AccountIdentity {
  id: string;
  /** Email or display name; `null` when unknown. */
  label: string | null;
}

// ── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'pm:known-accounts';

/** Reads the id → label map; empty when storage is unavailable or corrupt. */
export function readKnownAccounts(): Record<string, string> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  }
  catch {
    return {};
  }
}

/** Remembers the label of an account (no-op without a label). */
export function rememberAccount(account: AccountIdentity): void {
  if (!account.label) return;
  try {
    const map = readKnownAccounts();
    if (map[account.id] === account.label) return;
    map[account.id] = account.label;
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(map));
  }
  catch (err) {
    console.warn('[account] could not remember account label:', err);
  }
}

/** Label of an account id, or `null` if this device never saw it. */
export function accountLabel(userId: string): string | null {
  return readKnownAccounts()[userId] ?? null;
}

// ── Claims ───────────────────────────────────────────────────────────────────

/**
 * Identity from `useSupabaseUser()`, which holds JWT claims (`sub`) in
 * @nuxtjs/supabase v2 and a `User` (`id`) in older code paths.
 */
export function identityFromUser(user: unknown): AccountIdentity | null {
  if (!user || typeof user !== 'object') return null;
  const u = user as { sub?: unknown; id?: unknown; email?: unknown; user_metadata?: { display_name?: unknown } };
  const id = typeof u.sub === 'string' ? u.sub : typeof u.id === 'string' ? u.id : null;
  if (!id) return null;
  const email = typeof u.email === 'string' && u.email ? u.email : null;
  const name = typeof u.user_metadata?.display_name === 'string' ? u.user_metadata.display_name : null;
  return { id, label: email ?? name };
}

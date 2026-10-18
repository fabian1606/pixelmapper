/**
 * One-time migration of the custom fixture library from localStorage
 * (`pixelmapper:customFixtures`, name-based identity, `custom-<ms>` ids)
 * into the `custom-fixture` record collection (UUID ids, ADR 0004 D6/D21).
 */
import type { OflFixture } from '~/utils/ofl/types';

// ── Types ────────────────────────────────────────────────────────────────────

/** Payload of a `custom-fixture` record. */
export interface CustomFixtureData {
  /** Display name (no longer an identity — duplicates are allowed). */
  name: string;
  /** Fixture definition. */
  ofl: OflFixture;
  /** Creation time (epoch ms), used for list order. */
  createdAt: number;
}

/** Shape of an entry in the legacy localStorage list. */
interface LegacyStoredCustomFixture {
  id?: string;
  name?: string;
  ofl?: OflFixture;
  createdAt?: number;
}

/** Minimal sink the migration writes into (a record collection). */
export interface CustomFixtureSink {
  putMany(entries: ReadonlyArray<{ data: CustomFixtureData; id?: string }>): Promise<string[]>;
}

/** Minimal Web Locks API (`navigator.locks`), injectable for tests. */
export interface MigrationLockManager {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

/** Options of `migrateLegacyCustomFixtures`. */
export interface LegacyMigrationOptions {
  /** Lock manager; defaults to `navigator.locks`, `null` forces the fallback. */
  locks?: MigrationLockManager | null;
  /** Clock for the fallback claim (tests). */
  now?: () => number;
}

export const LEGACY_CUSTOM_FIXTURES_KEY = 'pixelmapper:customFixtures';
/** Lock that serialises the migration across tabs. */
export const LEGACY_MIGRATION_LOCK = 'pixelmapper:custom-fixture-migration';
/** Fallback claim: the legacy list moved here (with a timestamp) while one tab migrates it. */
export const LEGACY_MIGRATION_CLAIM_KEY = 'pixelmapper:customFixtures:migrating';
/** A fallback claim older than this belongs to a crashed tab and is taken over. */
const STALE_CLAIM_MS = 60_000;

// ── Migration ────────────────────────────────────────────────────────────────

/**
 * Moves legacy entries into `sink` with fresh UUIDs and removes the
 * localStorage key afterwards. Unreadable data is left in place (logged).
 * Returns the number of migrated fixtures.
 *
 * Two tabs opened at once must not both migrate (that would duplicate every
 * fixture under new UUIDs). With the Web Locks API the whole migration runs
 * under an exclusive cross-tab lock and the second tab finds the key gone.
 * Without it the list is claimed synchronously (read + moved to a claim key
 * in one task, see `migrateWithClaim`).
 */
export async function migrateLegacyCustomFixtures(
  sink: CustomFixtureSink,
  options: LegacyMigrationOptions = {},
): Promise<number> {
  if (typeof localStorage === 'undefined') return 0;
  const locks = options.locks !== undefined ? options.locks : defaultLockManager();
  if (locks) return locks.request(LEGACY_MIGRATION_LOCK, () => migrateUnlocked(sink));
  return migrateWithClaim(sink, options.now ?? Date.now);
}

/** `navigator.locks` where available. */
function defaultLockManager(): MigrationLockManager | null {
  const locks = (globalThis.navigator as { locks?: MigrationLockManager } | undefined)?.locks;
  return locks && typeof locks.request === 'function' ? locks : null;
}

/** Migration body; callers hold the cross-tab lock. */
async function migrateUnlocked(sink: CustomFixtureSink): Promise<number> {
  const raw = localStorage.getItem(LEGACY_CUSTOM_FIXTURES_KEY);
  if (raw === null) return 0;
  const entries = parseLegacy(raw);
  if (entries === null) return 0;
  if (entries.length > 0) await sink.putMany(entries);
  // Only after a successful write: a crash before this line re-runs the migration.
  localStorage.removeItem(LEGACY_CUSTOM_FIXTURES_KEY);
  return entries.length;
}

/**
 * Fallback without Web Locks: claims the list by moving it to the claim key
 * (synchronous read + write + remove, so a second tab sees no list). The
 * claim is removed after the write; a claim older than `STALE_CLAIM_MS` is
 * left over from a crashed tab and migrated again.
 */
async function migrateWithClaim(sink: CustomFixtureSink, now: () => number): Promise<number> {
  let raw = localStorage.getItem(LEGACY_CUSTOM_FIXTURES_KEY);
  if (raw !== null) {
    if (parseLegacy(raw) === null) return 0; // invalid JSON stays where it is
    localStorage.setItem(LEGACY_MIGRATION_CLAIM_KEY, JSON.stringify({ at: now(), raw }));
    localStorage.removeItem(LEGACY_CUSTOM_FIXTURES_KEY);
  }
  else {
    // No list: maybe an abandoned claim of a crashed tab.
    const claim = readClaim();
    if (!claim || now() - claim.at < STALE_CLAIM_MS) return 0;
    raw = claim.raw;
    localStorage.setItem(LEGACY_MIGRATION_CLAIM_KEY, JSON.stringify({ at: now(), raw }));
  }
  const entries = parseLegacy(raw) ?? [];
  if (entries.length > 0) await sink.putMany(entries);
  localStorage.removeItem(LEGACY_MIGRATION_CLAIM_KEY);
  return entries.length;
}

/** The fallback claim, if any. */
function readClaim(): { at: number; raw: string } | null {
  try {
    const value = JSON.parse(localStorage.getItem(LEGACY_MIGRATION_CLAIM_KEY) ?? 'null') as { at?: unknown; raw?: unknown } | null;
    return value && typeof value.at === 'number' && typeof value.raw === 'string' ? { at: value.at, raw: value.raw } : null;
  }
  catch {
    return null;
  }
}

/** Parses the legacy list into sink entries; `null` for invalid JSON (logged). */
function parseLegacy(raw: string): Array<{ data: CustomFixtureData }> | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch (err) {
    console.warn('[custom-fixtures] legacy library is not valid JSON, keeping it:', err);
    return null;
  }

  return (Array.isArray(parsed) ? parsed : [])
    .filter((e): e is LegacyStoredCustomFixture => !!e && typeof e === 'object' && !!(e as LegacyStoredCustomFixture).ofl)
    .map((e, index) => ({
      data: {
        name: e.name ?? e.ofl!.name ?? 'Custom Fixture',
        ofl: e.ofl!,
        // Legacy list was newest first; keep that order for missing timestamps.
        createdAt: typeof e.createdAt === 'number' ? e.createdAt : Date.now() - index,
      },
    }));
}

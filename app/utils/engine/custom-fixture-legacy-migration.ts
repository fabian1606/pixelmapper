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

export const LEGACY_CUSTOM_FIXTURES_KEY = 'pixelmapper:customFixtures';

// ── Migration ────────────────────────────────────────────────────────────────

/**
 * Moves legacy entries into `sink` with fresh UUIDs and removes the
 * localStorage key afterwards. Unreadable data is left in place (logged).
 * Returns the number of migrated fixtures.
 */
export async function migrateLegacyCustomFixtures(sink: CustomFixtureSink): Promise<number> {
  if (typeof localStorage === 'undefined') return 0;
  const raw = localStorage.getItem(LEGACY_CUSTOM_FIXTURES_KEY);
  if (raw === null) return 0;

  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch (err) {
    console.warn('[custom-fixtures] legacy library is not valid JSON, keeping it:', err);
    return 0;
  }

  const entries = (Array.isArray(parsed) ? parsed : [])
    .filter((e): e is LegacyStoredCustomFixture => !!e && typeof e === 'object' && !!(e as LegacyStoredCustomFixture).ofl)
    .map((e, index) => ({
      data: {
        name: e.name ?? e.ofl!.name ?? 'Custom Fixture',
        ofl: e.ofl!,
        // Legacy list was newest first; keep that order for missing timestamps.
        createdAt: typeof e.createdAt === 'number' ? e.createdAt : Date.now() - index,
      },
    }));

  if (entries.length > 0) await sink.putMany(entries);
  // Only after a successful write: a crash before this line re-runs the migration.
  localStorage.removeItem(LEGACY_CUSTOM_FIXTURES_KEY);
  return entries.length;
}

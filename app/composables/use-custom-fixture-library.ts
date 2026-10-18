/**
 * The user's custom fixture library (ADR 0004 D21): a `custom-fixture`
 * record collection in IndexedDB, synced to the account when signed in.
 *
 * Identity is the record's UUID, not the fixture name: saving without an id
 * always creates a new entry, saving with the id of an existing entry
 * (editing it) replaces that entry.
 */
import { computed, readonly, ref } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import type { OflFixture } from '~/utils/ofl/types';
import { createRecordCollection } from '~/utils/sync/records';
import type { RecordCollection } from '~/utils/sync/records';
import { hasIndexedDb } from '~/utils/sync/records/record-db';
import { migrateLegacyCustomFixtures } from '~/utils/engine/custom-fixture-legacy-migration';
import type { CustomFixtureData } from '~/utils/engine/custom-fixture-legacy-migration';

// ── Types ────────────────────────────────────────────────────────────────────

/** A custom fixture as shown in the library. */
export interface CustomFixtureEntry {
  id: string;
  name: string;
  ofl: OflFixture;
  createdAt: number;
}

export const CUSTOM_FIXTURE_KIND = 'custom-fixture';

// ── Singleton ────────────────────────────────────────────────────────────────

let collection: RecordCollection<CustomFixtureData> | null = null;
let initPromise: Promise<void> | null = null;
const loaded = ref(false);

/** Creates the collection and runs the localStorage migration once. */
function ensureCollection(): RecordCollection<CustomFixtureData> | null {
  if (!hasIndexedDb()) return null; // SSR: empty library
  if (collection) return collection;
  const created = createRecordCollection<CustomFixtureData>(CUSTOM_FIXTURE_KIND);
  collection = created;
  initPromise = (async () => {
    await created.ready;
    try { await migrateLegacyCustomFixtures(created); }
    catch (err) { console.error('[custom-fixtures] legacy migration failed:', err); }
    loaded.value = true;
  })();
  return created;
}

/** Resets the module singleton (tests only). */
export function resetCustomFixtureLibraryForTests(): void {
  collection = null;
  initPromise = null;
  loaded.value = false;
}

// ── Composable ───────────────────────────────────────────────────────────────

/** Access to the custom fixture library. */
export function useCustomFixtureLibrary(): {
  customFixtures: ComputedRef<CustomFixtureEntry[]>;
  loaded: Readonly<Ref<boolean>>;
  ready: () => Promise<void>;
  saveCustomFixture: (ofl: OflFixture, id?: string | null) => Promise<string | null>;
  removeCustomFixture: (id: string) => Promise<void>;
} {
  const lib = ensureCollection();

  /** Entries, newest first (by creation, so edits keep their position). */
  const customFixtures = computed<CustomFixtureEntry[]>(() => {
    if (!lib) return [];
    return lib.items.value
      .map(item => ({ id: item.id, name: item.data.name, ofl: item.data.ofl, createdAt: item.data.createdAt }))
      .sort((a, b) => b.createdAt - a.createdAt);
  });

  /** Resolves once the local list is loaded and migrated. */
  async function ready(): Promise<void> {
    await initPromise;
  }

  /** Saves `ofl`: replaces entry `id` if it exists, otherwise creates a new entry. */
  async function saveCustomFixture(ofl: OflFixture, id?: string | null): Promise<string | null> {
    if (!lib) return null;
    await ready();
    const existing = id ? lib.get(id) : undefined;
    const data: CustomFixtureData = {
      name: ofl.name,
      ofl,
      createdAt: existing?.data.createdAt ?? Date.now(),
    };
    return lib.put(data, existing ? existing.id : undefined);
  }

  /** Deletes an entry (synced as a tombstone when it belongs to the account). */
  async function removeCustomFixture(id: string): Promise<void> {
    if (!lib) return;
    await lib.remove(id);
  }

  return { customFixtures, loaded: readonly(loaded), ready, saveCustomFixture, removeCustomFixture };
}

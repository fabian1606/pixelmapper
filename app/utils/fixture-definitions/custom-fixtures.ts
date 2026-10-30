/**
 * Custom fixture accessor (plan M4.7, decision D11; storage ADR 0004 D21).
 *
 * The only module that reads or writes the user's custom fixture
 * definitions. They live in the `custom-fixture` user record collection
 * (IndexedDB, synced to the account when signed in); the legacy
 * `localStorage['pixelmapper:customFixtures']` list is migrated once on
 * first use. Callers (add dialog, editor, extension API, RDM lookup) never
 * touch storage directly.
 *
 * Identity is the record's UUID, not the fixture name: saving without an id
 * creates a new entry, saving with an id replaces (or creates) that entry.
 * The whole OFL definition is the record payload, so the RDM fields
 * (`pixelmapper.rdmManufacturerId`, `rdm.modelId`, `rdmPersonalityIndex`)
 * round-trip unchanged.
 *
 * Reads are synchronous on the loaded list (empty until `customFixturesReady()`
 * resolved); writes are asynchronous.
 */
import { readonly, ref } from 'vue';
import type { Ref } from 'vue';
import type { OflFixture } from '~/utils/ofl/types';
import { createRecordCollection } from '~/utils/sync/records';
import type { RecordCollection } from '~/utils/sync/records';
import { hasIndexedDb } from '~/utils/sync/records/record-db';
import { migrateLegacyCustomFixtures } from '~/utils/engine/custom-fixture-legacy-migration';
import type { CustomFixtureData } from '~/utils/engine/custom-fixture-legacy-migration';
import { customDefinitionKey } from './definition-keys';

// ── Types ────────────────────────────────────────────────────────────────────

/** One stored custom fixture definition. */
export interface StoredCustomFixture {
  /** Record UUID (definition key `custom/<id>`). */
  id: string;
  /** Display name (= `ofl.name`; not an identity, duplicates are allowed). */
  name: string;
  /** The definition in OFL format. */
  ofl: OflFixture;
  /** Creation time (ms since epoch), used for list order. */
  createdAt: number;
}

/** Record kind of the library. */
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
export function resetCustomFixturesForTests(): void {
  collection = null;
  initPromise = null;
  loaded.value = false;
}

/** Whether the local list is loaded (and migrated). */
export const customFixturesLoaded: Readonly<Ref<boolean>> = readonly(loaded);

/** Resolves once the local list is loaded and migrated. */
export async function customFixturesReady(): Promise<void> {
  ensureCollection();
  await initPromise;
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * All custom fixtures, newest first (by creation, so edits keep their
 * position). Reactive inside computeds; a fresh array on every call.
 */
export function getCustomFixtures(): StoredCustomFixture[] {
  const lib = ensureCollection();
  if (!lib) return [];
  return lib.items.value
    .map(item => ({ id: item.id, name: item.data.name, ofl: item.data.ofl, createdAt: item.data.createdAt }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** One custom fixture by id. */
export function getCustomFixture(id: string): StoredCustomFixture | undefined {
  const item = ensureCollection()?.get(id);
  return item ? { id: item.id, name: item.data.name, ofl: item.data.ofl, createdAt: item.data.createdAt } : undefined;
}

/** Definition key (`'custom/<id>'`) of a stored custom fixture. */
export function customFixtureKey(stored: Pick<StoredCustomFixture, 'id'>): string {
  return customDefinitionKey(stored.id);
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Saves a definition. With `id`: replaces that entry (keeping its creation
 * time) or creates it under that id; without: creates a new entry with a
 * fresh UUID. Returns the stored entry, `null` without IndexedDB (SSR).
 */
export async function saveCustomFixture(ofl: OflFixture, id?: string | null): Promise<StoredCustomFixture | null> {
  const lib = ensureCollection();
  if (!lib) return null;
  await customFixturesReady();
  const existing = id ? lib.get(id) : undefined;
  const data: CustomFixtureData = {
    name: ofl.name,
    ofl,
    createdAt: existing?.data.createdAt ?? Date.now(),
  };
  const savedId = await lib.put(data, id ?? undefined);
  return { id: savedId, ...data };
}

/**
 * Adds a definition as a NEW custom fixture, never replacing an existing
 * one (used by extensions). A name already in use gets a numeric suffix
 * (`'Name (2)'`); `ofl.name` is updated to match.
 *
 * @throws Error when no storage is available (SSR).
 */
export async function addCustomFixture(ofl: OflFixture): Promise<StoredCustomFixture> {
  await customFixturesReady();
  const names = new Set(getCustomFixtures().map(c => c.name));
  let name = ofl.name;
  for (let n = 2; names.has(name); n++) name = `${ofl.name} (${n})`;
  const stored = await saveCustomFixture(name === ofl.name ? ofl : { ...ofl, name });
  if (!stored) throw new Error('custom fixtures are not available here (no IndexedDB)');
  return stored;
}

/** Removes a custom fixture by id (synced as a tombstone when it belongs to an account). */
export async function removeCustomFixture(id: string): Promise<void> {
  const lib = ensureCollection();
  if (!lib) return;
  await lib.remove(id);
}

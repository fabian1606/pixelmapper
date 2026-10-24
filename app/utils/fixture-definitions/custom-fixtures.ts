/**
 * Custom fixture accessor (plan M4.7, decision D11).
 *
 * The only module that reads or writes the user's custom fixture
 * definitions. They live in `localStorage['pixelmapper:customFixtures']`
 * today and move to the user account later; callers never touch storage
 * directly, so only this file changes then.
 */
import type { OflFixture } from '~/utils/ofl/types';
import { customDefinitionKey } from './definition-keys';

/** One stored custom fixture definition. */
export interface StoredCustomFixture {
  /** Stable id, e.g. `'custom-1729800000000'`. */
  id: string;
  /** Display name (= `ofl.name`; used to match updates). */
  name: string;
  /** The definition in OFL format. */
  ofl: OflFixture;
  /** Creation time (ms since epoch). */
  createdAt: number;
}

/** Storage key (unchanged since before the accessor existed). */
const STORAGE_KEY = 'pixelmapper:customFixtures';

/** Reads the raw list; empty on missing storage or malformed JSON. */
function readAll(): StoredCustomFixture[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed as StoredCustomFixture[] : [];
  }
  catch (err) {
    console.warn('[custom-fixtures] could not read custom fixtures:', err);
    return [];
  }
}

/** Writes the list. */
function writeAll(list: StoredCustomFixture[]): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(list));
  }
  catch (err) {
    console.error('[custom-fixtures] could not save custom fixtures:', err);
  }
}

/** All custom fixtures, newest first. Returns a fresh array on every call. */
export function getCustomFixtures(): StoredCustomFixture[] {
  return readAll();
}

/** One custom fixture by id. */
export function getCustomFixture(id: string): StoredCustomFixture | undefined {
  return readAll().find(c => c.id === id);
}

/** Definition key (`'custom/<id>'`) of a stored custom fixture. */
export function customFixtureKey(stored: Pick<StoredCustomFixture, 'id'>): string {
  return customDefinitionKey(stored.id);
}

/**
 * Saves a definition: replaces the definition of the custom fixture with
 * the same name, otherwise adds a new entry at the front. Returns the
 * stored entry.
 */
export function saveCustomFixture(ofl: OflFixture): StoredCustomFixture {
  const list = readAll();
  const existing = list.find(c => c.name === ofl.name);
  if (existing) {
    existing.ofl = ofl;
    writeAll(list);
    return existing;
  }
  // Time-based id as before; suffixed when two saves share a millisecond.
  let id = `custom-${Date.now()}`;
  for (let n = 2; list.some(c => c.id === id); n++) id = `custom-${Date.now()}-${n}`;
  const entry: StoredCustomFixture = {
    id,
    name: ofl.name,
    ofl,
    createdAt: Date.now(),
  };
  writeAll([entry, ...list]);
  return entry;
}

/**
 * Adds a definition as a NEW custom fixture, never replacing an existing
 * one (used by extensions, which must not overwrite the user's fixtures).
 * A name already in use gets a numeric suffix (`'Name (2)'`); `ofl.name`
 * is updated to match. Returns the stored entry.
 */
export function addCustomFixture(ofl: OflFixture): StoredCustomFixture {
  const names = new Set(readAll().map(c => c.name));
  let name = ofl.name;
  for (let n = 2; names.has(name); n++) name = `${ofl.name} (${n})`;
  return saveCustomFixture(name === ofl.name ? ofl : { ...ofl, name });
}

/** Removes a custom fixture by id. */
export function removeCustomFixture(id: string): void {
  writeAll(readAll().filter(c => c.id !== id));
}

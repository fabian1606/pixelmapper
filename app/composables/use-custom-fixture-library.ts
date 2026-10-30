/**
 * The user's custom fixture library (ADR 0004 D21) for components: a
 * reactive view on the custom fixture accessor
 * (`~/utils/fixture-definitions/custom-fixtures`), which owns the
 * `custom-fixture` record collection and the legacy migration.
 *
 * Identity is the record's UUID, not the fixture name: saving without an id
 * always creates a new entry, saving with the id of an entry (editing it)
 * replaces that entry.
 */
import { computed } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import type { OflFixture } from '~/utils/ofl/types';
import {
  CUSTOM_FIXTURE_KIND,
  customFixturesLoaded,
  customFixturesReady,
  getCustomFixtures,
  removeCustomFixture,
  resetCustomFixturesForTests,
  saveCustomFixture,
} from '~/utils/fixture-definitions/custom-fixtures';
import type { StoredCustomFixture } from '~/utils/fixture-definitions/custom-fixtures';

// ── Types ────────────────────────────────────────────────────────────────────

/** A custom fixture as shown in the library. */
export type CustomFixtureEntry = StoredCustomFixture;

export { CUSTOM_FIXTURE_KIND };

/** Resets the accessor singleton (tests only). */
export function resetCustomFixtureLibraryForTests(): void {
  resetCustomFixturesForTests();
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
  /** Entries, newest first (by creation, so edits keep their position). */
  const customFixtures = computed<CustomFixtureEntry[]>(() => getCustomFixtures());

  /** Saves `ofl`: replaces entry `id` when given, otherwise creates a new entry. */
  async function save(ofl: OflFixture, id?: string | null): Promise<string | null> {
    return (await saveCustomFixture(ofl, id))?.id ?? null;
  }

  return {
    customFixtures,
    loaded: customFixturesLoaded,
    ready: customFixturesReady,
    saveCustomFixture: save,
    removeCustomFixture,
  };
}

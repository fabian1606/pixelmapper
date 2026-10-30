/**
 * Test support for code that uses the custom fixture accessor: an empty,
 * loaded custom fixture library on a fresh fake IndexedDB (no account, no
 * legacy localStorage list).
 */
import 'fake-indexeddb/auto';
import { useFreshDevice } from '~/utils/sync/records/fake-record-remote';
import { resetRecordSessionForTests } from '~/utils/sync/records/record-session';
import { LEGACY_CUSTOM_FIXTURES_KEY } from '~/utils/engine/custom-fixture-legacy-migration';
import { customFixturesReady, resetCustomFixturesForTests } from './custom-fixtures';

/** Resets the library to empty and waits until it is loaded. */
export async function useFreshCustomFixtureLibrary(): Promise<void> {
  resetRecordSessionForTests();
  resetCustomFixturesForTests();
  await useFreshDevice();
  globalThis.localStorage?.removeItem(LEGACY_CUSTOM_FIXTURES_KEY);
  await customFixturesReady();
}

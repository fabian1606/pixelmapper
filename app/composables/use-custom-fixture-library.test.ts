/**
 * Custom fixture library (WP-RECORDS): localStorage migration, UUID
 * identity and editing semantics.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OflFixture } from '~/utils/ofl/types';
import { useFreshDevice } from '~/utils/sync/records/fake-record-remote';
import { listRecords } from '~/utils/sync/records/record-db';
import { resetRecordSessionForTests } from '~/utils/sync/records/record-session';
import { LEGACY_CUSTOM_FIXTURES_KEY } from '~/utils/engine/custom-fixture-legacy-migration';
import { CUSTOM_FIXTURE_KIND, resetCustomFixtureLibraryForTests, useCustomFixtureLibrary } from './use-custom-fixture-library';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Minimal fixture definition. */
function ofl(name: string, channels = 1): OflFixture {
  return {
    name,
    categories: ['Other'],
    availableChannels: {},
    modes: [{ name: 'Default', channels: Array.from({ length: channels }, (_, i) => `Ch ${i + 1}`) }],
  } as unknown as OflFixture;
}

beforeEach(async () => {
  await useFreshDevice();
  localStorage.clear();
});

afterEach(() => {
  resetRecordSessionForTests();
  resetCustomFixtureLibraryForTests();
});

describe('legacy localStorage migration', () => {
  it('moves entries into IndexedDB with UUIDs and removes the key', async () => {
    localStorage.setItem(LEGACY_CUSTOM_FIXTURES_KEY, JSON.stringify([
      { id: 'custom-2', name: 'Bar', ofl: ofl('Bar'), createdAt: 2000 },
      { id: 'custom-1', name: 'Foo', ofl: ofl('Foo', 3), createdAt: 1000 },
    ]));
    const lib = useCustomFixtureLibrary();
    await lib.ready();

    expect(localStorage.getItem(LEGACY_CUSTOM_FIXTURES_KEY)).toBeNull();
    expect(lib.customFixtures.value.map(f => f.name)).toEqual(['Bar', 'Foo']);
    expect(lib.customFixtures.value.every(f => UUID.test(f.id))).toBe(true);
    expect(lib.customFixtures.value[1]!.ofl.modes[0]!.channels).toHaveLength(3);
    expect(lib.customFixtures.value[1]!.createdAt).toBe(1000);
    const stored = await listRecords(CUSTOM_FIXTURE_KIND);
    expect(stored).toHaveLength(2);
    expect(stored.every(r => r.ownerUserId === null)).toBe(true);
  });

  it('runs only once', async () => {
    localStorage.setItem(LEGACY_CUSTOM_FIXTURES_KEY, JSON.stringify([{ name: 'Foo', ofl: ofl('Foo') }]));
    await useCustomFixtureLibrary().ready();
    resetRecordSessionForTests();
    resetCustomFixtureLibraryForTests();
    const lib = useCustomFixtureLibrary();
    await lib.ready();
    expect(lib.customFixtures.value).toHaveLength(1);
  });

  it('keeps unreadable legacy data in place', async () => {
    localStorage.setItem(LEGACY_CUSTOM_FIXTURES_KEY, '{not json');
    const lib = useCustomFixtureLibrary();
    await lib.ready();
    expect(localStorage.getItem(LEGACY_CUSTOM_FIXTURES_KEY)).toBe('{not json');
    expect(lib.customFixtures.value).toEqual([]);
  });
});

describe('identity and editing', () => {
  it('saving a fixture with an existing name creates a new entry', async () => {
    const lib = useCustomFixtureLibrary();
    const a = await lib.saveCustomFixture(ofl('Par'));
    const b = await lib.saveCustomFixture(ofl('Par'));
    expect(a).not.toBe(b);
    expect(lib.customFixtures.value).toHaveLength(2);
  });

  it('saving with the id of an entry replaces it and keeps its position', async () => {
    const lib = useCustomFixtureLibrary();
    const first = await lib.saveCustomFixture(ofl('First'));
    await new Promise(r => setTimeout(r, 2));
    await lib.saveCustomFixture(ofl('Second'));
    const id = await lib.saveCustomFixture(ofl('First renamed', 4), first);
    expect(id).toBe(first);
    expect(lib.customFixtures.value.map(f => f.name)).toEqual(['Second', 'First renamed']);
    expect(lib.customFixtures.value[1]!.ofl.modes[0]!.channels).toHaveLength(4);
  });

  it('removes entries', async () => {
    const lib = useCustomFixtureLibrary();
    const id = await lib.saveCustomFixture(ofl('Gone'));
    await lib.removeCustomFixture(id!);
    expect(lib.customFixtures.value).toEqual([]);
  });
});

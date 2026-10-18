/**
 * Bundled OFL library (ADR 0004 D18): index fetched once, queries run
 * client-side, definitions loaded per fixture from `/ofl/`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OflLibraryIndex } from '~/utils/ofl/library-query';
import { createBundledFixtureLibrary } from './fixture-library';

const INDEX: OflLibraryIndex = {
  manufacturers: [{ key: 'acme', name: 'ACME', fixtureCount: 1 }],
  fixtures: [{ key: 'acme/spot', manufacturer: 'ACME', manufacturerKey: 'acme', name: 'Spot', shortName: 'S', categories: [], modes: [] }],
};

/** Stubs fetch with a URL → JSON body map (missing = 404). */
function stubFetch(files: Record<string, unknown>) {
  const fn = vi.fn(async (url: string) => {
    const body = files[url];
    return body === undefined
      ? new Response('missing', { status: 404 })
      : new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bundled fixture library', () => {
  it('loads the index once and answers like the web route', async () => {
    const fetchFn = stubFetch({ '/ofl/index.json': INDEX });
    const lib = createBundledFixtureLibrary();
    expect(await lib.listManufacturers()).toEqual(INDEX.manufacturers);
    const page = await lib.queryFixtures({ manufacturer: 'acme' });
    expect(page).toEqual({ total: 1, offset: 0, limit: 1, items: INDEX.fixtures });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('loads definitions per fixture and rejects empty path segments', async () => {
    const def = { name: 'Spot', availableChannels: {}, modes: [] };
    stubFetch({ '/ofl/fixtures/acme/spot.json': def });
    const lib = createBundledFixtureLibrary();
    expect(await lib.getFixture('acme', 'spot')).toEqual(def);
    await expect(lib.getFixture('..', 'spot')).rejects.toThrow(/Invalid/);
    await expect(lib.getFixture('acme', 'gone')).rejects.toThrow(/404/);
  });

  it('retries the index after a failed load', async () => {
    const fetchFn = stubFetch({});
    const lib = createBundledFixtureLibrary();
    await expect(lib.listManufacturers()).rejects.toThrow();
    stubFetch({ '/ofl/index.json': INDEX });
    expect(await lib.listManufacturers()).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

/**
 * Bundled fixture library of the desktop app (ADR 0004 D18).
 *
 * The Tauri build ships the OFL library as static files next to the SPA
 * (written by `scripts/tauri/ofl-bundle.ts`, served from `/ofl/`):
 * - `/ofl/index.json` — manufacturers, summaries of every fixture (~270 KB)
 *   and the RDM IDs table, loaded once on first use;
 * - `/ofl/fixtures/<manufacturer>/<fixture>.json` — full definitions, loaded
 *   on demand.
 * Queries run client-side with the same logic as the Nitro route, so the
 * response shapes match the web exactly. Everything works offline.
 */
import type { FixtureLibrary } from '../fixture-library';
import { fetchJson, safeSegment } from '../fixture-library';
import type { OflFixture } from '~/utils/ofl/types';
import { isFixtureDefinition, queryFixtures, type OflLibraryIndex } from '~/utils/ofl/library-query';

/** URL prefix of the bundled library (see `OFL_BUNDLE_PREFIX` in the build step). */
export const OFL_BASE = '/ofl';

/** Creates the bundled fixture library; the index is fetched lazily and cached. */
export function createBundledFixtureLibrary(base = OFL_BASE): FixtureLibrary {
  let index: Promise<OflLibraryIndex> | null = null;

  /** Loads the index once; a failed load is retried on the next call. */
  const loadIndex = (): Promise<OflLibraryIndex> => {
    index ??= fetchJson<OflLibraryIndex>(`${base}/index.json`).catch((err) => {
      index = null;
      throw err;
    });
    return index;
  };

  return {
    listManufacturers: async () => (await loadIndex()).manufacturers,

    queryFixtures: async query => queryFixtures((await loadIndex()).fixtures, query),

    async getFixture(manufacturerKey, fixtureKey) {
      const mf = safeSegment(manufacturerKey);
      const fix = safeSegment(fixtureKey);
      if (!mf || !fix) throw new Error('Invalid fixture path');
      const fixture = await fetchJson<OflFixture>(`${base}/fixtures/${mf}/${fix}.json`);
      // The bundle omits redirects; guard anyway (the web route answers 404 here).
      if (!isFixtureDefinition(fixture)) throw new Error(`Fixture not found: ${mf}/${fix}`);
      return fixture;
    },

    findByRdm: async (manufacturerId, modelId) => (await loadIndex()).rdm
      .filter(e => e.manufacturerId === manufacturerId && e.modelId === modelId)
      .map(e => e.key),
  };
}

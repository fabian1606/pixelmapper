/**
 * Web fixture library: the Nitro routes `/api/fixtures` (ADR 0004 D18 —
 * the web keeps the server route). Uses Nuxt's global `$fetch` exactly like
 * the callers did before (base URL handling, tests stub it).
 */
import type { FixtureLibrary } from '../fixture-library';
import { safeSegment } from '../fixture-library';
import type { ManufacturerSummary, OflFixture } from '~/utils/ofl/types';
import type { FixturePage } from '~/utils/ofl/library-query';

/** Creates the HTTP-backed fixture library. */
export function createWebFixtureLibrary(): FixtureLibrary {
  return {
    listManufacturers: () => $fetch<ManufacturerSummary[]>('/api/fixtures?mode=manufacturers'),

    queryFixtures(query) {
      const params = new URLSearchParams({ mode: 'fixtures' });
      if (query.search) params.set('search', query.search);
      if (query.category) params.set('category', query.category);
      if (query.manufacturer) params.set('manufacturer', query.manufacturer);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      if (query.offset !== undefined) params.set('offset', String(query.offset));
      return $fetch<FixturePage>(`/api/fixtures?${params.toString()}`);
    },

    getFixture: (manufacturerKey, fixtureKey) =>
      $fetch<OflFixture>(`/api/fixtures/${safeSegment(manufacturerKey)}/${safeSegment(fixtureKey)}`),
  };
}

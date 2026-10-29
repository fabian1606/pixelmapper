/**
 * OFL fixture library source of the running platform (host-only, ADR 0003
 * D3, ADR 0004 D18). Each `#platform` entry exports `getFixtureLibrary()`
 * returning this shape.
 *
 * Web: the Nitro routes `/api/fixtures` (server assets, SSR build).
 * Desktop: an index + per-fixture JSON bundled into the SPA at build time
 * (`scripts/tauri/ofl-bundle.ts`), so the library works offline.
 *
 * Response shapes are identical on both platforms.
 */
import type { ManufacturerSummary, OflFixture } from '~/utils/ofl/types';
import type { FixtureQuery, FixturePage } from '~/utils/ofl/library-query';

export type { FixtureQuery, FixturePage };

export interface FixtureLibrary {
  /** All manufacturers with their fixture counts, sorted by name. */
  listManufacturers(): Promise<ManufacturerSummary[]>;
  /** Fixture summaries (see `queryFixtures` for paging rules). */
  queryFixtures(query: FixtureQuery): Promise<FixturePage>;
  /**
   * The full OFL definition of one fixture.
   * Rejects when it does not exist or is a redirect.
   */
  getFixture(manufacturerKey: string, fixtureKey: string): Promise<OflFixture>;
}

/** Strips everything but `[A-Za-z0-9_-]` from a path segment (same rule as the Nitro route). */
export function safeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9\-_]/g, '');
}

/** Fetches JSON and rejects on non-2xx answers (like `$fetch`). */
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  return await res.json() as T;
}

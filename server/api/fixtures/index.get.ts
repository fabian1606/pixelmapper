import type { OflFixture, OflManufacturers, FixtureSummary, ManufacturerSummary } from '../../../app/utils/ofl/types';
import { buildFixtureSummary, queryFixtures, sortByName } from '../../../app/utils/ofl/library-query';

const storage = () => useStorage('assets:ofl-fixtures');

/**
 * GET /api/fixtures
 *
 * Supports two modes:
 * 1. mode=manufacturers
 *    Returns a list of all manufacturers with their fixture counts.
 *
 * 2. mode=fixtures (default)
 *    Returns fixture summaries. If manufacturer query is provided, returns ALL fixtures for it.
 *    If search/category is provided, returns filtered results with limit.
 *
 * Summary building and filtering live in `app/utils/ofl/library-query.ts`,
 * shared with the bundled desktop library (ADR 0004 D18).
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const mode = String(query.mode ?? 'fixtures');
  const search = String(query.search ?? '').toLowerCase().trim();
  const category = String(query.category ?? '').toLowerCase().trim();
  const manufacturerFilter = String(query.manufacturer ?? '').toLowerCase().trim();
  const limit = parseInt(String(query.limit ?? '50'), 10);
  const offset = parseInt(String(query.offset ?? '0'), 10);

  const store = storage();

  // Load manufacturer display names
  const manufacturers = await store.getItem<OflManufacturers>('manufacturers.json') ?? {};

  // Get all keys — format: "manufacturer:fixture.json" OR "manufacturers.json"
  const allKeys = await store.getKeys();

  // Count fixture files per manufacturer directory (redirect files included)
  const fixtureCountMap = new Map<string, number>();
  for (const key of allKeys) {
    const parts = key.split(':');
    if (parts.length === 2 && parts[0] && parts[1]?.endsWith('.json')) {
      fixtureCountMap.set(parts[0], (fixtureCountMap.get(parts[0]) ?? 0) + 1);
    }
  }
  const manufacturerKeys = Array.from(fixtureCountMap.keys());

  // ─── Mode: Manufacturers ──────────────────────────────────────────────────
  if (mode === 'manufacturers' && !search && !category) {
    const results: ManufacturerSummary[] = manufacturerKeys.map(mfKey => ({
      key: mfKey,
      name: (manufacturers as OflManufacturers)[mfKey]?.name ?? mfKey,
      fixtureCount: fixtureCountMap.get(mfKey) ?? 0,
    }));
    return sortByName(results);
  }

  // ─── Mode: Fixtures (Search or Single Manufacturer) ───────────────────────
  const results: FixtureSummary[] = [];

  // Only read the files of one manufacturer when that is all the query needs
  const targets = (manufacturerFilter && !search && !category)
    ? [manufacturerFilter]
    : manufacturerKeys;

  for (const mfKey of targets) {
    if (!fixtureCountMap.has(mfKey)) continue;

    const mfName = (manufacturers as OflManufacturers)[mfKey]?.name ?? mfKey;
    const mfKeys = allKeys.filter(k => k.startsWith(`${mfKey}:`) && k.endsWith('.json'));

    for (const storageKey of mfKeys) {
      const fixtureKey = storageKey.replace(`${mfKey}:`, '').replace('.json', '');
      try {
        const fixture = await store.getItem<OflFixture>(storageKey);
        if (!fixture) continue;
        const summary = buildFixtureSummary(mfKey, mfName, fixtureKey, fixture);
        if (summary) results.push(summary);
      } catch { continue; }
    }
  }

  return queryFixtures(sortByName(results), {
    search,
    category,
    manufacturer: manufacturerFilter,
    limit,
    offset,
  });
});

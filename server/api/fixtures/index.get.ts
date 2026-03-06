import type { OflFixture, OflManufacturers, FixtureSummary, ManufacturerSummary } from '../../../app/utils/ofl/types';

const storage = () => useStorage('assets:ofl-fixtures');

/**
 * GET /api/fixtures
 *
 * Supports two modes:
 * 1. mode=manufacturers (default)
 *    Returns a list of all manufacturers with their fixture counts.
 *
 * 2. mode=fixtures
 *    Returns fixture summaries. If manufacturer query is provided, returns ALL fixtures for it.
 *    If search/category is provided, returns filtered results with limit.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const mode = String(query.mode ?? 'fixtures');
  const search = String(query.search ?? '').toLowerCase().trim();
  const category = String(query.category ?? '').toLowerCase().trim();
  const manufacturerFilter = String(query.manufacturer ?? '').toLowerCase().trim();
  const limit = Math.min(parseInt(String(query.limit ?? '50'), 10), 1000);
  const offset = parseInt(String(query.offset ?? '0'), 10);

  const store = storage();

  // Load manufacturer display names
  const manufacturers = await store.getItem<OflManufacturers>('manufacturers.json') ?? {};

  // Get all keys — format: "manufacturer:fixture.json" OR "manufacturers.json"
  const allKeys = await store.getKeys();

  // Build a unique set of manufacturer directory names
  const manufacturerKeysSet = new Set<string>();
  for (const key of allKeys) {
    const parts = key.split(':');
    if (parts.length === 2 && parts[0] && parts[1]?.endsWith('.json')) {
      manufacturerKeysSet.add(parts[0]);
    }
  }
  const manufacturerKeys = Array.from(manufacturerKeysSet);

  // ─── Mode: Manufacturers ──────────────────────────────────────────────────
  if (mode === 'manufacturers' && !search && !category) {
    const fixtureCountMap = new Map<string, number>();
    for (const key of allKeys) {
      const parts = key.split(':');
      if (parts.length === 2 && parts[0] && parts[1]?.endsWith('.json')) {
        const mfKey = parts[0];
        fixtureCountMap.set(mfKey, (fixtureCountMap.get(mfKey) ?? 0) + 1);
      }
    }

    const results: ManufacturerSummary[] = manufacturerKeys.map(mfKey => ({
      key: mfKey,
      name: (manufacturers as OflManufacturers)[mfKey]?.name ?? mfKey,
      fixtureCount: fixtureCountMap.get(mfKey) ?? 0,
    }));

    results.sort((a, b) => a.name.localeCompare(b.name));
    return results;
  }

  // ─── Mode: Fixtures (Search or Single Manufacturer) ───────────────────────
  const results: FixtureSummary[] = [];

  const targets = (manufacturerFilter && !search && !category)
    ? [manufacturerFilter]
    : manufacturerKeys;

  for (const mfKey of targets) {
    if (!manufacturerKeys.includes(mfKey)) continue;

    const mfName = (manufacturers as OflManufacturers)[mfKey]?.name ?? mfKey;

    // Get all fixture keys for this manufacturer
    const mfKeys = allKeys.filter(k => k.startsWith(`${mfKey}:`) && k.endsWith('.json'));

    for (const storageKey of mfKeys) {
      const fixtureKey = storageKey.replace(`${mfKey}:`, '').replace('.json', '');

      try {
        const fixture = await store.getItem<OflFixture>(storageKey);
        if (!fixture) continue;

        // Skip redirects
        if (!fixture.availableChannels || !fixture.modes) continue;

        // Filters
        if (search) {
          const nameMatch = fixture.name.toLowerCase().includes(search);
          const shortMatch = fixture.shortName?.toLowerCase().includes(search);
          if (!nameMatch && !shortMatch) continue;
        }

        if (category) {
          const hasCategory = fixture.categories.some(c => c.toLowerCase().includes(category));
          if (!hasCategory) continue;
        }

        results.push({
          key: `${mfKey}/${fixtureKey}`,
          manufacturer: mfName,
          manufacturerKey: mfKey,
          name: fixture.name,
          shortName: fixture.shortName,
          categories: fixture.categories,
          modes: fixture.modes.map(m => ({
            name: m.name,
            shortName: m.shortName,
            channelCount: m.channels.filter(ch => {
              if (!ch) return false;
              if (typeof ch !== 'string') return true; // Matrix insert represents multiple channels
              return !Object.values(fixture.availableChannels).some(
                c => c.fineChannelAliases?.includes(ch as string)
              );
            }).length,
          })),
        });
      } catch { continue; }
    }
  }

  results.sort((a, b) => a.name.localeCompare(b.name));

  const shouldPaginate = !!(search || category);
  const finalItems = shouldPaginate
    ? results.slice(offset, offset + limit)
    : results;

  return {
    total: results.length,
    offset: shouldPaginate ? offset : 0,
    limit: shouldPaginate ? limit : results.length,
    items: finalItems,
  };
});

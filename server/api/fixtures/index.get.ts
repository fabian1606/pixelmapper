import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { OflFixture, OflManufacturers, FixtureSummary, ManufacturerSummary } from '../../../app/utils/ofl/types';

const OFL_FIXTURES_DIR = path.resolve(process.cwd(), 'ofl-data/fixtures');

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

  // Load manufacturer display names
  const manufacturersPath = path.join(OFL_FIXTURES_DIR, 'manufacturers.json');
  const manufacturersRaw = await fs.readFile(manufacturersPath, 'utf-8');
  const manufacturers = JSON.parse(manufacturersRaw) as OflManufacturers;

  const entries = await fs.readdir(OFL_FIXTURES_DIR, { withFileTypes: true });
  const manufacturerKeys = entries
    .filter(e => e.isDirectory())
    .map(e => e.name);

  // ─── Mode: Manufacturers ──────────────────────────────────────────────────
  if (mode === 'manufacturers' && !search && !category) {
    const results: ManufacturerSummary[] = [];

    for (const mfKey of manufacturerKeys) {
      if (mfKey === 'schema') continue;

      const mfPath = path.join(OFL_FIXTURES_DIR, mfKey);
      const files = await fs.readdir(mfPath);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      results.push({
        key: mfKey,
        name: manufacturers[mfKey]?.name ?? mfKey,
        fixtureCount: jsonFiles.length
      });
    }

    results.sort((a, b) => a.name.localeCompare(b.name));
    return results;
  }

  // ─── Mode: Fixtures (Search or Single Manufacturer) ───────────────────────
  const results: FixtureSummary[] = [];

  // If a specific manufacturer is requested and NO global search, load ONLY that manufacturer
  const targets = (manufacturerFilter && !search && !category)
    ? [manufacturerFilter]
    : manufacturerKeys;

  for (const mfKey of targets) {
    if (mfKey === 'schema') continue;

    // Safety check for filtered list
    if (!manufacturerKeys.includes(mfKey)) continue;

    const mfName = manufacturers[mfKey]?.name ?? mfKey;
    const mfPath = path.join(OFL_FIXTURES_DIR, mfKey);
    let files: string[] = [];
    try {
      files = await fs.readdir(mfPath);
    } catch { continue; }

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const fixtureKey = file.replace('.json', '');
      const fullPath = path.join(mfPath, file);

      try {
        const raw = await fs.readFile(fullPath, 'utf-8');
        const fixture = JSON.parse(raw) as OflFixture;

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
              return !Object.values(fixture.availableChannels).some(
                c => c.fineChannelAliases?.includes(ch)
              );
            }).length,
          })),
        });
      } catch { continue; }
    }
  }

  results.sort((a, b) => a.name.localeCompare(b.name));

  // For specific manufacturers, we return the whole list (no slice) 
  // unless a limit/offset was explicitly passed for a search.
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

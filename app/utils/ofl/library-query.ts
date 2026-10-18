/**
 * Pure OFL library queries shared by every fixture-library source
 * (ADR 0004 D18): the Nitro route `/api/fixtures` (web) and the bundled
 * index shipped with the desktop app. Keeping summary building, filtering
 * and paging in one place guarantees identical response shapes.
 */
import type { FixtureSummary, ManufacturerSummary, OflFixture } from './types';

// ── Types ────────────────────────────────────────────────────────────────────

/** Query of the fixture list (same parameters as `GET /api/fixtures?mode=fixtures`). */
export interface FixtureQuery {
  /** Case-insensitive substring of the name or short name. */
  search?: string;
  /** Case-insensitive substring of one of the categories. */
  category?: string;
  /** Manufacturer key; only honoured without `search` / `category`. */
  manufacturer?: string;
  /** Page size for search/category queries (default 50, max 1000). */
  limit?: number;
  /** Page offset for search/category queries. */
  offset?: number;
}

/** One page of fixture summaries (response shape of `GET /api/fixtures`). */
export interface FixturePage {
  total: number;
  offset: number;
  limit: number;
  items: FixtureSummary[];
}

/** Precomputed library index (bundled with the desktop app). */
export interface OflLibraryIndex {
  /** Manufacturers sorted by display name, with their file counts. */
  manufacturers: ManufacturerSummary[];
  /** Summaries of every valid (non-redirect) fixture. */
  fixtures: FixtureSummary[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;

// ── Summaries ────────────────────────────────────────────────────────────────

/** True for real fixture definitions (OFL redirect files lack channels/modes). */
export function isFixtureDefinition(fixture: Partial<OflFixture> | null | undefined): fixture is OflFixture {
  return !!fixture && !!fixture.availableChannels && !!fixture.modes;
}

/**
 * Builds the list summary of one fixture, or `null` for redirect files.
 * Fine-channel aliases are not counted as channels; a matrix insert counts as one.
 */
export function buildFixtureSummary(
  manufacturerKey: string,
  manufacturerName: string,
  fixtureKey: string,
  fixture: OflFixture,
): FixtureSummary | null {
  if (!isFixtureDefinition(fixture)) return null;
  return {
    key: `${manufacturerKey}/${fixtureKey}`,
    manufacturer: manufacturerName,
    manufacturerKey,
    name: fixture.name,
    shortName: fixture.shortName,
    categories: fixture.categories,
    modes: fixture.modes.map(m => ({
      name: m.name,
      shortName: m.shortName,
      channelCount: m.channels.filter((ch) => {
        if (!ch) return false;
        if (typeof ch !== 'string') return true; // Matrix insert represents multiple channels
        return !Object.values(fixture.availableChannels ?? {}).some(
          c => c.fineChannelAliases?.includes(ch as string),
        );
      }).length,
    })),
  } as FixtureSummary;
}

/** Sorts summaries by display name (in place) and returns them. */
export function sortByName<T extends { name: string }>(items: T[]): T[] {
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Queries ──────────────────────────────────────────────────────────────────

/** Normalizes a free-text query parameter. */
function norm(value: string | undefined): string {
  return (value ?? '').toLowerCase().trim();
}

/**
 * Filters and pages fixture summaries exactly like `GET /api/fixtures`:
 * - with `search` or `category`: all manufacturers, filtered, paginated;
 * - with only `manufacturer`: every fixture of that manufacturer, unpaginated;
 * - otherwise: every fixture, unpaginated.
 * `fixtures` must already be sorted by name.
 */
export function queryFixtures(fixtures: FixtureSummary[], query: FixtureQuery): FixturePage {
  const search = norm(query.search);
  const category = norm(query.category);
  const manufacturer = norm(query.manufacturer);
  const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = query.offset ?? 0;

  const filtered = fixtures.filter((f) => {
    if (manufacturer && !search && !category && f.manufacturerKey !== manufacturer) return false;
    if (search) {
      const nameMatch = f.name.toLowerCase().includes(search);
      const shortMatch = f.shortName?.toLowerCase().includes(search);
      if (!nameMatch && !shortMatch) return false;
    }
    if (category && !f.categories.some(c => c.toLowerCase().includes(category))) return false;
    return true;
  });

  const paginate = !!(search || category);
  return {
    total: filtered.length,
    offset: paginate ? offset : 0,
    limit: paginate ? limit : filtered.length,
    items: paginate ? filtered.slice(offset, offset + limit) : filtered,
  };
}

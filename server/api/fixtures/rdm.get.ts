import type { OflFixtureEntry } from '../../../app/utils/fixture-definitions/ofl-rdm-index';
import { findOflKeysByRdm, parseRdmIdParam } from '../../../app/utils/fixture-definitions/ofl-rdm-index';

/** OFL fixture storage (`'<manufacturer>:<fixture>.json'`, `'manufacturers.json'`). */
const storage = () => useStorage('assets:ofl-fixtures');

/** Max. memoized (manufacturerId, modelId) pairs; the oldest entry is evicted first. */
const MAX_CACHE_ENTRIES = 1024;

/** Memoized lookups per `'<manufacturerId>:<modelId>'` (promises, so parallel requests share one scan). */
const cache = new Map<string, Promise<string[]>>();

/** Scans the OFL storage for fixtures with the given RDM IDs. */
async function scan(manufacturerId: number, modelId: number): Promise<string[]> {
  const store = storage();
  const manufacturers = await store.getItem<Record<string, unknown>>('manufacturers.json') ?? {};
  // Fetched lazily: only needed when some manufacturer has the requested `rdmId`.
  let allKeys: string[] | null = null;

  /** Yields the raw fixture JSONs of one manufacturer. */
  async function* fixturesOf(manufacturerKey: string): AsyncGenerator<OflFixtureEntry> {
    allKeys ??= await store.getKeys();
    const prefix = `${manufacturerKey}:`;
    for (const storageKey of allKeys) {
      if (!storageKey.startsWith(prefix) || !storageKey.endsWith('.json')) continue;
      const fixtureKey = storageKey.slice(prefix.length, -'.json'.length);
      // Nested keys (`mf:sub:x.json`) are not fixtures.
      if (!fixtureKey || fixtureKey.includes(':')) continue;
      try {
        yield { fixtureKey, json: await store.getItem(storageKey) };
      }
      catch (err) {
        console.warn(`[api/fixtures/rdm] could not read "${storageKey}":`, err);
      }
    }
  }

  return findOflKeysByRdm(manufacturers, manufacturerId, modelId, fixturesOf);
}

/**
 * GET /api/fixtures/rdm?manufacturerId=<int>&modelId=<int>
 *
 * Returns the OFL definition keys (`'<manufacturer>/<fixture>'`) of all
 * fixtures with the given RDM manufacturer ID (`manufacturers.json` `rdmId`)
 * and RDM model ID (`rdm.modelId`), sorted: `{ keys: string[] }`. Empty when
 * nothing matches; 400 when an ID is missing or not an integer in 0..65535.
 *
 * Example: GET /api/fixtures/rdm?manufacturerId=25972&modelId=513
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const manufacturerId = parseRdmIdParam(query.manufacturerId);
  const modelId = parseRdmIdParam(query.modelId);
  if (manufacturerId === null || modelId === null) {
    throw createError({
      statusCode: 400,
      statusMessage: 'manufacturerId and modelId must be integers in 0..65535',
    });
  }

  const cacheKey = `${manufacturerId}:${modelId}`;
  let pending = cache.get(cacheKey);
  if (!pending) {
    pending = scan(manufacturerId, modelId).catch((err) => {
      // Do not memoize failures; the next request scans again.
      cache.delete(cacheKey);
      throw err;
    });
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(cacheKey, pending);
  }

  // Copy, so callers cannot mutate the memoized list.
  return { keys: [...await pending] };
});

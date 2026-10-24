/**
 * Resolves fixture definition keys to OFL definitions and builds fixtures
 * from them (plan M4.1, M4.3).
 *
 * Custom fixtures come from the custom fixture accessor (synchronous, always
 * fresh); OFL fixtures are fetched from the Nitro route
 * `/api/fixtures/<manufacturer>/<fixture>` and cached for the session.
 */
import type { OflFixture } from '~/utils/ofl/types';
import type { Fixture } from '~/utils/engine/core/fixture';
import { createFixtureFromOfl } from '~/utils/ofl/fixture-factory';
import { getCustomFixture } from './custom-fixtures';
import { parseDefinitionKey } from './definition-keys';

/** A definition ready to build fixtures from. */
export interface ResolvedDefinition {
  /** Definition key (`'<manufacturer>/<fixture>'` or `'custom/<id>'`). */
  key: string;
  /** The OFL-format definition. */
  definition: OflFixture;
  /** Manufacturer display name ('' for custom fixtures). */
  manufacturer: string;
}

/** Fetches JSON from a same-origin route. Replaceable in tests. */
export type JsonFetcher = (url: string) => Promise<unknown>;

/** Default fetcher: `fetch` + JSON, throwing on HTTP errors. */
const defaultFetcher: JsonFetcher = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
};

let fetcher: JsonFetcher = defaultFetcher;

/** Cached OFL definitions by key (promises, so parallel calls share one request). */
const oflCache = new Map<string, Promise<OflFixture | null>>();
/** Cached manufacturer key → display name map. */
let manufacturerNames: Promise<Map<string, string>> | null = null;

/** Replaces the JSON fetcher and clears the caches (tests). */
export function setDefinitionFetcher(next: JsonFetcher | null): void {
  fetcher = next ?? defaultFetcher;
  oflCache.clear();
  manufacturerNames = null;
}

/** Loads one OFL definition (cached; `null` when missing or on errors). */
function fetchOflDefinition(manufacturer: string, fixture: string): Promise<OflFixture | null> {
  const key = `${manufacturer}/${fixture}`;
  let pending = oflCache.get(key);
  if (!pending) {
    pending = fetcher(`/api/fixtures/${encodeURIComponent(manufacturer)}/${encodeURIComponent(fixture)}`)
      .then(data => data as OflFixture)
      .catch((err) => {
        console.warn(`[fixture-definitions] could not load "${key}":`, err);
        oflCache.delete(key);
        return null;
      });
    oflCache.set(key, pending);
  }
  return pending;
}

/** Display name of an OFL manufacturer key (falls back to the key). */
async function manufacturerName(key: string): Promise<string> {
  manufacturerNames ??= fetcher('/api/fixtures?mode=manufacturers')
    .then(list => new Map((list as { key: string; name: string }[]).map(m => [m.key, m.name])))
    .catch((err) => {
      console.warn('[fixture-definitions] could not load manufacturer names:', err);
      manufacturerNames = null;
      return new Map<string, string>();
    });
  return (await manufacturerNames).get(key) ?? key;
}

/**
 * Resolves a definition key. Returns `null` for malformed keys, unknown
 * custom fixtures and OFL fixtures that cannot be loaded.
 */
export async function resolveFixtureDefinition(key: string): Promise<ResolvedDefinition | null> {
  const parsed = parseDefinitionKey(key);
  if (!parsed) return null;
  if (parsed.source === 'custom') {
    const stored = getCustomFixture(parsed.id);
    return stored ? { key, definition: stored.ofl, manufacturer: '' } : null;
  }
  const [definition, manufacturer] = await Promise.all([
    fetchOflDefinition(parsed.manufacturer, parsed.fixture),
    manufacturerName(parsed.manufacturer),
  ]);
  return definition ? { key, definition, manufacturer } : null;
}

/**
 * Builds a fixture from a resolved definition and records its source
 * (`key` + `modeIndex`). OFL fixtures also get `oflKey`. Throws when the
 * definition has no mode `modeIndex`.
 */
export function createFixtureFromDefinition(resolved: ResolvedDefinition, modeIndex = 0): Fixture {
  if (!resolved.definition.modes[modeIndex]) {
    throw new Error(`fixture definition "${resolved.key}" has no mode ${modeIndex}`);
  }
  const fixture = createFixtureFromOfl(resolved.definition, modeIndex, undefined, resolved.manufacturer);
  fixture.source = { key: resolved.key, modeIndex };
  if (parseDefinitionKey(resolved.key)?.source === 'ofl') fixture.oflKey = resolved.key;
  return fixture;
}

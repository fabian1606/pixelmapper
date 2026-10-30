/**
 * Fixture definition lookup by RDM IDs (plan M4.8, decision D10 step 1).
 *
 * Finds the definition of a discovered device from its RDM manufacturer and
 * model ID: custom fixtures first (`ofl.pixelmapper.rdmManufacturerId` +
 * `ofl.rdm.modelId`), then the platform fixture library: OFL plus
 * Pixelmapper's own `fixture-library/` (web: `GET /api/fixtures/rdm`,
 * desktop: the bundled index). The match carries the mode mapping by RDM
 * personality (`rdmPersonalityIndex`).
 */
import type { OflFixture } from '~/utils/ofl/types';
import { createFixtureFromOfl } from '~/utils/ofl/fixture-factory';
import { useFixtureLibrary } from '~/composables/use-fixture-library';
import { customFixtureKey, customFixturesReady, getCustomFixtures } from './custom-fixtures';
import type { StoredCustomFixture } from './custom-fixtures';
import { isRdmId } from './ofl-rdm-index';
import { resolveFixtureDefinition } from './resolve-definition';
import type { JsonFetcher } from './resolve-definition';

/** One mode of a matched definition. */
export interface RdmDefinitionMode {
  /** 0-based mode index (as used by `createFixtureFromDefinition`). */
  index: number;
  /** Mode name. */
  name: string;
  /** DMX channel count of the mode (matrix inserts expanded). */
  channelCount: number;
  /** 1-based RDM personality of the mode, when the definition declares one. */
  rdmPersonalityIndex?: number;
}

/** Result of findFixtureDefinitionByRdm. */
export interface RdmDefinitionMatch {
  /** Definition key for adding fixtures (`'<manufacturer>/<fixture>'` or `'custom/<id>'`). */
  key: string;
  /** Where the definition comes from. */
  source: 'custom' | 'ofl';
  /** Definition name. */
  name: string;
  /** Manufacturer display name ('' for custom fixtures). */
  manufacturer: string;
  /** All modes of the definition, in definition order. */
  modes: RdmDefinitionMode[];
  /** RDM personality (1-based) → 0-based mode index; only modes with `rdmPersonalityIndex`. */
  modeByPersonality: Record<number, number>;
}

/** Test override (URL-based, same route as the web library); `null` = platform library. */
let fetcher: JsonFetcher | null = null;

/** Cached library key lists per `'<manufacturerId>:<modelId>'` (successful lookups only). */
const oflKeysCache = new Map<string, Promise<string[]>>();

/**
 * Replaces the platform library lookup by a JSON fetcher for
 * `GET /api/fixtures/rdm` and clears the cache (tests); `null` restores it.
 * Definitions themselves are loaded through `resolveFixtureDefinition`,
 * whose fetcher is set via `setDefinitionFetcher`.
 */
export function setRdmLookupFetcher(next: JsonFetcher | null): void {
  fetcher = next;
  oflKeysCache.clear();
}

/**
 * DMX channel count of a mode, computed by the fixture factory (matrix
 * inserts expanded). Falls back to the non-empty entries of the mode's
 * channel list when the factory cannot build the mode.
 */
function modeChannelCount(definition: OflFixture, index: number): number {
  try {
    return createFixtureFromOfl(definition, index, `rdm-lookup-${index}`).channels.length;
  }
  catch (err) {
    console.warn(`[rdm-lookup] could not build mode ${index} of "${definition.name}":`, err);
    return definition.modes[index]?.channels.filter(ch => ch !== null).length ?? 0;
  }
}

/**
 * Builds the match for a definition: its modes with channel counts and the
 * personality → mode mapping. When two modes declare the same personality,
 * the first one wins.
 */
export function buildRdmDefinitionMatch(
  key: string,
  source: RdmDefinitionMatch['source'],
  definition: OflFixture,
  manufacturer: string,
): RdmDefinitionMatch {
  const modes: RdmDefinitionMode[] = [];
  const modeByPersonality: Record<number, number> = {};
  definition.modes.forEach((mode, index) => {
    const entry: RdmDefinitionMode = {
      index,
      name: mode.name,
      channelCount: modeChannelCount(definition, index),
    };
    const personality = mode.rdmPersonalityIndex;
    if (typeof personality === 'number' && Number.isInteger(personality) && personality >= 1) {
      entry.rdmPersonalityIndex = personality;
      if (!(personality in modeByPersonality)) modeByPersonality[personality] = index;
    }
    modes.push(entry);
  });
  return { key, source, name: definition.name, manufacturer, modes, modeByPersonality };
}

/**
 * `meta.authors` entry of definitions the Art-Net connector generates from a
 * device's RDM description (`GENERATED_AUTHOR` in
 * `extensions/connector-artnet/devices/fixture-generation.ts`).
 */
export const RDM_GENERATED_AUTHOR = 'Pixelmapper (generated from RDM)';

/** True for a custom fixture generated from RDM data (not written by a user). */
function isRdmGenerated(stored: StoredCustomFixture): boolean {
  return stored.ofl?.meta?.authors?.includes(RDM_GENERATED_AUTHOR) ?? false;
}

/** Custom fixtures (newest first) with the given RDM IDs. */
function findCustomFixturesByRdm(manufacturerId: number, modelId: number): StoredCustomFixture[] {
  return getCustomFixtures().filter(stored =>
    stored.ofl?.pixelmapper?.rdmManufacturerId === manufacturerId
    && stored.ofl?.rdm?.modelId === modelId,
  );
}

/**
 * Library definition keys with the given RDM IDs (cached). Errors (network,
 * missing index, malformed responses) are logged and yield `[]`.
 */
function fetchOflKeys(manufacturerId: number, modelId: number): Promise<string[]> {
  const cacheKey = `${manufacturerId}:${modelId}`;
  let pending = oflKeysCache.get(cacheKey);
  if (!pending) {
    // `Promise.resolve().then` also turns a synchronously throwing fetcher into a rejection.
    pending = Promise.resolve()
      .then((): Promise<unknown> => (fetcher
        ? fetcher(`/api/fixtures/rdm?manufacturerId=${manufacturerId}&modelId=${modelId}`)
          .then(data => (data as { keys?: unknown } | null)?.keys)
        : useFixtureLibrary().findByRdm(manufacturerId, modelId)))
      .then((keys) => {
        if (!Array.isArray(keys)) throw new Error('response has no "keys" array');
        return keys.filter((k): k is string => typeof k === 'string');
      })
      .catch((err) => {
        console.warn(`[rdm-lookup] OFL lookup for RDM ${manufacturerId}/${modelId} failed:`, err);
        oflKeysCache.delete(cacheKey);
        return [];
      });
    oflKeysCache.set(cacheKey, pending);
  }
  return pending;
}

/**
 * Finds the fixture definition of a device by its RDM manufacturer and model
 * ID (D10 step 1), in this order:
 * 1. a custom fixture written by the user (newest first),
 * 2. the first fixture of the platform library (OFL + own `fixture-library/`),
 * 3. a custom fixture generated from RDM data — only a fallback, so a library
 *    definition added later replaces an earlier generated guess.
 * Returns `null` for invalid IDs (not an integer in 0..0xFFFF), when nothing
 * matches, or when the library lookup or definition cannot be loaded.
 */
export async function findFixtureDefinitionByRdm(
  manufacturerId: number,
  modelId: number,
): Promise<RdmDefinitionMatch | null> {
  if (!isRdmId(manufacturerId) || !isRdmId(modelId)) return null;

  await customFixturesReady();
  const customs = findCustomFixturesByRdm(manufacturerId, modelId);
  const own = customs.find(stored => !isRdmGenerated(stored));
  if (own) return buildRdmDefinitionMatch(customFixtureKey(own), 'custom', own.ofl, '');

  const [key] = await fetchOflKeys(manufacturerId, modelId);
  const resolved = key ? await resolveFixtureDefinition(key) : null;
  if (resolved) return buildRdmDefinitionMatch(resolved.key, 'ofl', resolved.definition, resolved.manufacturer);

  const generated = customs[0];
  return generated ? buildRdmDefinitionMatch(customFixtureKey(generated), 'custom', generated.ofl, '') : null;
}

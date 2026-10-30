/**
 * OFL lookup by RDM IDs (plan M4.8, decision D10).
 *
 * Pure helpers behind `GET /api/fixtures/rdm`: the OFL keeps the RDM
 * manufacturer ID per manufacturer (`manufacturers.json` → `rdmId`) and the
 * RDM model ID per fixture (`rdm.modelId`). The scan only reads the fixtures
 * of manufacturers whose `rdmId` matches, so it stays cheap.
 *
 * Free of Nitro APIs (the route passes a storage-backed fixture source) and
 * imported by relative path from the server, so it must not use `~` aliases.
 */

/** Largest valid RDM manufacturer / model ID (16 bit). */
export const RDM_ID_MAX = 0xffff;

/** One raw OFL fixture JSON of a manufacturer (a fixture or a redirect). */
export interface OflFixtureEntry {
  /** Fixture key within the manufacturer (file name without `.json`). */
  fixtureKey: string;
  /** Parsed JSON; `null`/`undefined` when the entry could not be read. */
  json: unknown;
}

/** Yields the raw fixture JSONs of one manufacturer (sync or async). */
export type OflFixtureSource = (
  manufacturerKey: string,
) => Iterable<OflFixtureEntry> | AsyncIterable<OflFixtureEntry>;

/** True for a valid RDM ID: an integer in `0..0xFFFF`. */
export function isRdmId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= RDM_ID_MAX;
}

/**
 * Parses an RDM ID query parameter (decimal digits only, `0..0xFFFF`).
 * Returns `null` for missing, repeated or malformed values.
 */
export function parseRdmIdParam(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{1,5}$/.test(value)) return null;
  const id = Number.parseInt(value, 10);
  return isRdmId(id) ? id : null;
}

/** Narrows an unknown JSON value to a plain object. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Manufacturer keys of `manufacturers.json` whose `rdmId` equals
 * `manufacturerId`. Non-object entries (e.g. `$schema`) are ignored.
 */
export function manufacturerKeysByRdmId(
  manufacturers: Readonly<Record<string, unknown>>,
  manufacturerId: number,
): string[] {
  return Object.entries(manufacturers)
    .filter(([, entry]) => asRecord(entry)?.rdmId === manufacturerId)
    .map(([key]) => key);
}

/**
 * True when a raw fixture JSON is a real fixture (not a redirect: it has
 * `availableChannels` and `modes`) with `rdm.modelId === modelId`.
 */
export function matchesRdmModel(json: unknown, modelId: number): boolean {
  const fixture = asRecord(json);
  if (!fixture || !fixture.availableChannels || !fixture.modes) return false;
  return asRecord(fixture.rdm)?.modelId === modelId;
}

/**
 * OFL definition keys (`'<manufacturer>/<fixture>'`) of all fixtures with the
 * given RDM manufacturer and model ID, sorted for a stable "first match".
 * `fixturesOf` is only called for manufacturers whose `rdmId` matches.
 */
export async function findOflKeysByRdm(
  manufacturers: Readonly<Record<string, unknown>>,
  manufacturerId: number,
  modelId: number,
  fixturesOf: OflFixtureSource,
): Promise<string[]> {
  if (!isRdmId(manufacturerId) || !isRdmId(modelId)) return [];
  const keys: string[] = [];
  for (const manufacturerKey of manufacturerKeysByRdmId(manufacturers, manufacturerId)) {
    // `for await` accepts both sync and async iterables.
    for await (const entry of fixturesOf(manufacturerKey)) {
      if (matchesRdmModel(entry.json, modelId)) keys.push(`${manufacturerKey}/${entry.fixtureKey}`);
    }
  }
  return keys.sort();
}

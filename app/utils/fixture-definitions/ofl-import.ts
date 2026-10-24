/**
 * OFL JSON import for the custom fixture editor (plan M4.7, decision D11).
 *
 * Parses the text of an Open Fixture Library fixture file and validates it
 * leniently: only what the editor really needs is required (`name`, a
 * non-empty `modes` array whose entries have `channels`, and at least one of
 * `availableChannels` / `templateChannels`). Everything the `OflFixture` type
 * requires but a hand-written file may lack (`$schema`, `meta`, `categories`,
 * mode names) is filled with sensible defaults. Malformed optional RDM data is
 * dropped instead of failing the whole import.
 *
 * Pure function — no DOM, no storage — so it is unit-testable and reusable.
 */
import type { OflFixture } from '~/utils/ofl/types';

// ── Types ────────────────────────────────────────────────────────────────────

/** Result of {@link parseOflFixtureJson}: the fixture or a readable error. */
export type OflImportResult =
  | { ok: true; fixture: OflFixture }
  | { ok: false; error: string };

// ── Constants ────────────────────────────────────────────────────────────────

/** `$schema` URL used when the imported file does not declare one. */
export const OFL_FIXTURE_SCHEMA_URL =
  'https://raw.githubusercontent.com/OpenLightingProject/open-fixture-library/master/schemas/fixture.json';

/** Author written into `meta.authors` when the file has none. */
export const OFL_IMPORT_DEFAULT_AUTHOR = 'Imported via Pixelmapper';

/** Category used when the file has no (valid) `categories` array. */
export const OFL_IMPORT_DEFAULT_CATEGORY = 'Other';

/** Largest valid RDM manufacturer / model ID (both are 16-bit values). */
const RDM_ID_MAX = 0xffff;

// ── Small guards ─────────────────────────────────────────────────────────────

/** True for plain JSON objects (not arrays, not null). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for non-empty strings (after trimming). */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** True for integers within `[min, max]`. */
function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Today's date as `YYYY-MM-DD` (OFL `meta` date format). */
function today(): string {
  return new Date().toISOString().split('T')[0]!;
}

// ── Section normalizers ──────────────────────────────────────────────────────

/** Fills `meta` with defaults, keeping every valid field of the original. */
function normalizeMeta(raw: unknown): OflFixture['meta'] {
  const meta = isRecord(raw) ? raw : {};
  const authors = Array.isArray(meta.authors)
    ? meta.authors.filter(isNonEmptyString)
    : [];
  const createDate = isNonEmptyString(meta.createDate) ? meta.createDate : today();
  const lastModifyDate = isNonEmptyString(meta.lastModifyDate) ? meta.lastModifyDate : createDate;
  return {
    ...meta,
    authors: authors.length > 0 ? authors : [OFL_IMPORT_DEFAULT_AUTHOR],
    createDate,
    lastModifyDate,
  } as OflFixture['meta'];
}

/** Keeps the string categories; falls back to `['Other']`. */
function normalizeCategories(raw: unknown): string[] {
  const categories = Array.isArray(raw) ? raw.filter(isNonEmptyString) : [];
  return categories.length > 0 ? categories : [OFL_IMPORT_DEFAULT_CATEGORY];
}

/**
 * Validates the modes. Returns the normalized modes or an error message.
 * Missing mode names become `Mode N`; an invalid `rdmPersonalityIndex`
 * (not a positive integer) is dropped.
 */
function normalizeModes(raw: unknown): OflFixture['modes'] | string {
  if (!Array.isArray(raw) || raw.length === 0) {
    return 'The fixture needs a non-empty "modes" array.';
  }
  const modes: OflFixture['modes'] = [];
  for (let i = 0; i < raw.length; i++) {
    const mode = raw[i];
    const label = isRecord(mode) && isNonEmptyString(mode.name) ? `"${mode.name}"` : `#${i + 1}`;
    if (!isRecord(mode)) return `Mode #${i + 1} is not an object.`;
    if (!Array.isArray(mode.channels)) return `Mode ${label} has no "channels" array.`;

    const normalized: Record<string, unknown> = {
      ...mode,
      name: isNonEmptyString(mode.name) ? mode.name : `Mode ${i + 1}`,
    };
    if ('rdmPersonalityIndex' in normalized && !isIntInRange(mode.rdmPersonalityIndex, 1, RDM_ID_MAX)) {
      delete normalized.rdmPersonalityIndex;
    }
    modes.push(normalized as OflFixture['modes'][number]);
  }
  return modes;
}

/**
 * Checks `availableChannels` / `templateChannels`: at least one must be an
 * object, and a present one must not be anything else. Returns an error
 * message or `null` when fine.
 */
function checkChannelMaps(json: Record<string, unknown>): string | null {
  for (const key of ['availableChannels', 'templateChannels'] as const) {
    if (json[key] !== undefined && !isRecord(json[key])) {
      return `"${key}" must be an object that maps channel names to channel definitions.`;
    }
  }
  if (!isRecord(json.availableChannels) && !isRecord(json.templateChannels)) {
    return 'The fixture needs an "availableChannels" and/or "templateChannels" object.';
  }
  return null;
}

/** Keeps `rdm` only when `modelId` is a valid 16-bit integer. */
function normalizeRdm(raw: unknown): OflFixture['rdm'] | undefined {
  if (!isRecord(raw) || !isIntInRange(raw.modelId, 0, RDM_ID_MAX)) return undefined;
  return {
    modelId: raw.modelId,
    ...(isNonEmptyString(raw.softwareVersion) ? { softwareVersion: raw.softwareVersion } : {}),
  };
}

/** Drops an out-of-range `pixelmapper.rdmManufacturerId`; keeps everything else. */
function normalizePixelmapper(raw: unknown): OflFixture['pixelmapper'] | undefined {
  if (!isRecord(raw)) return undefined;
  const copy: Record<string, unknown> = { ...raw };
  if ('rdmManufacturerId' in copy && !isIntInRange(copy.rdmManufacturerId, 0, RDM_ID_MAX)) {
    delete copy.rdmManufacturerId;
  }
  return copy as OflFixture['pixelmapper'];
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parses and leniently validates the text of an OFL fixture JSON file.
 *
 * @param text Raw file contents.
 * @returns `{ ok: true, fixture }` with defaults filled in, or
 *          `{ ok: false, error }` with a message suitable for the UI.
 */
export function parseOflFixtureJson(text: string): OflImportResult {
  // Guard: syntactically valid JSON.
  let json: unknown;
  try {
    json = JSON.parse(text);
  }
  catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `The file is not valid JSON (${detail}).` };
  }

  // Guard: a single fixture object (not a list, not a primitive).
  if (!isRecord(json)) {
    return { ok: false, error: 'The file does not contain an OFL fixture object.' };
  }

  // Guard: the fields the editor cannot work without.
  if (!isNonEmptyString(json.name)) {
    return { ok: false, error: 'The fixture has no "name".' };
  }
  const modes = normalizeModes(json.modes);
  if (typeof modes === 'string') return { ok: false, error: modes };
  const channelError = checkChannelMaps(json);
  if (channelError) return { ok: false, error: channelError };

  // Assemble the fixture: originals first, then normalized / defaulted fields.
  const fixture: Record<string, unknown> = {
    ...json,
    $schema: isNonEmptyString(json.$schema) ? json.$schema : OFL_FIXTURE_SCHEMA_URL,
    name: json.name.trim(),
    categories: normalizeCategories(json.categories),
    meta: normalizeMeta(json.meta),
    modes,
  };
  const rdm = normalizeRdm(json.rdm);
  if (rdm) fixture.rdm = rdm;
  else delete fixture.rdm;
  const pixelmapper = normalizePixelmapper(json.pixelmapper);
  if (pixelmapper) fixture.pixelmapper = pixelmapper;
  else delete fixture.pixelmapper;

  return { ok: true, fixture: fixture as OflFixture };
}

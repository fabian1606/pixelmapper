// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { OflFixtureEntry } from './ofl-rdm-index';
import {
  findOflKeysByRdm,
  isRdmId,
  manufacturerKeysByRdmId,
  matchesRdmModel,
  parseRdmIdParam,
} from './ofl-rdm-index';

/** A minimal real (non-redirect) OFL fixture JSON with an RDM model ID. */
function fixtureJson(modelId?: number): Record<string, unknown> {
  return {
    name: `Fixture ${modelId ?? 'none'}`,
    ...(modelId === undefined ? {} : { rdm: { modelId } }),
    availableChannels: { Dimmer: { capability: { type: 'Intensity' } } },
    modes: [{ name: '1ch', channels: ['Dimmer'] }],
  };
}

/** An OFL redirect JSON (no `availableChannels`/`modes`), here even with an RDM ID. */
const REDIRECT_JSON = { name: 'old', redirectTo: 'acme/new', reason: 'FixtureRenamed', rdm: { modelId: 7 } };

/** `manufacturers.json`-like map, including the non-object `$schema` entry. */
const MANUFACTURERS = {
  $schema: 'https://example.org/manufacturers.json',
  acme: { name: 'ACME', rdmId: 100 },
  other: { name: 'Other', rdmId: 200 },
  plain: { name: 'Plain (no RDM ID)' },
};

/** Fixture JSONs per manufacturer key. */
const FIXTURES: Record<string, OflFixtureEntry[]> = {
  acme: [
    { fixtureKey: 'zeta', json: fixtureJson(7) },
    { fixtureKey: 'alpha', json: fixtureJson(7) },
    { fixtureKey: 'other-model', json: fixtureJson(8) },
    { fixtureKey: 'no-rdm', json: fixtureJson() },
    { fixtureKey: 'renamed', json: REDIRECT_JSON },
    { fixtureKey: 'unreadable', json: null },
  ],
  other: [{ fixtureKey: 'same-model', json: fixtureJson(7) }],
  plain: [{ fixtureKey: 'same-model', json: fixtureJson(7) }],
};

/** Synchronous fixture source over FIXTURES, spied to check which manufacturers are scanned. */
function syncSource() {
  return vi.fn((manufacturerKey: string): Iterable<OflFixtureEntry> => FIXTURES[manufacturerKey] ?? []);
}

describe('ofl-rdm-index', () => {
  it('validates RDM IDs and query parameters', () => {
    expect(isRdmId(0)).toBe(true);
    expect(isRdmId(0xffff)).toBe(true);
    expect(isRdmId(0x10000)).toBe(false);
    expect(isRdmId(-1)).toBe(false);
    expect(isRdmId(1.5)).toBe(false);
    expect(isRdmId(Number.NaN)).toBe(false);
    expect(isRdmId('1')).toBe(false);

    expect(parseRdmIdParam('25972')).toBe(25972);
    expect(parseRdmIdParam('0')).toBe(0);
    expect(parseRdmIdParam('65535')).toBe(65535);
    expect(parseRdmIdParam('65536')).toBeNull();
    expect(parseRdmIdParam('-1')).toBeNull();
    expect(parseRdmIdParam('1.5')).toBeNull();
    expect(parseRdmIdParam('0x10')).toBeNull();
    expect(parseRdmIdParam('')).toBeNull();
    expect(parseRdmIdParam(undefined)).toBeNull();
    expect(parseRdmIdParam(['1', '2'])).toBeNull();
  });

  it('finds manufacturers by rdmId and ignores non-object entries', () => {
    expect(manufacturerKeysByRdmId(MANUFACTURERS, 100)).toEqual(['acme']);
    expect(manufacturerKeysByRdmId(MANUFACTURERS, 300)).toEqual([]);
  });

  it('matches real fixtures by rdm.modelId and skips redirects', () => {
    expect(matchesRdmModel(fixtureJson(7), 7)).toBe(true);
    expect(matchesRdmModel(fixtureJson(8), 7)).toBe(false);
    expect(matchesRdmModel(fixtureJson(), 7)).toBe(false);
    expect(matchesRdmModel(REDIRECT_JSON, 7)).toBe(false);
    expect(matchesRdmModel(null, 7)).toBe(false);
  });

  it('returns the sorted keys of matching fixtures and skips redirects', async () => {
    const source = syncSource();
    await expect(findOflKeysByRdm(MANUFACTURERS, 100, 7, source)).resolves.toEqual(['acme/alpha', 'acme/zeta']);
    // Only the manufacturer with the matching rdmId is scanned.
    expect(source).toHaveBeenCalledTimes(1);
    expect(source).toHaveBeenCalledWith('acme');
  });

  it('returns no keys when no fixture has the model ID', async () => {
    await expect(findOflKeysByRdm(MANUFACTURERS, 100, 999, syncSource())).resolves.toEqual([]);
  });

  it('never scans manufacturers without a matching rdmId', async () => {
    const source = syncSource();
    // `plain` has a fixture with model 7 but no rdmId; no manufacturer has rdmId 300.
    await expect(findOflKeysByRdm(MANUFACTURERS, 300, 7, source)).resolves.toEqual([]);
    expect(source).not.toHaveBeenCalled();
  });

  it('returns no keys for invalid IDs', async () => {
    const source = syncSource();
    await expect(findOflKeysByRdm(MANUFACTURERS, -1, 7, source)).resolves.toEqual([]);
    await expect(findOflKeysByRdm(MANUFACTURERS, 100, 0x10000, source)).resolves.toEqual([]);
    expect(source).not.toHaveBeenCalled();
  });

  it('accepts async fixture sources', async () => {
    /** Async generator over FIXTURES (like the Nitro storage source). */
    async function* asyncSource(manufacturerKey: string): AsyncGenerator<OflFixtureEntry> {
      for (const entry of FIXTURES[manufacturerKey] ?? []) yield entry;
    }
    await expect(findOflKeysByRdm(MANUFACTURERS, 200, 7, asyncSource)).resolves.toEqual(['other/same-model']);
  });

  // ── Real OFL data ──────────────────────────────────────────────────────────
  // ETC (`rdmId` 25972) ColorSource PAR has `rdm.modelId` 513.

  /** The OFL fixture library checked out by `scripts/setup-ofl.sh`. */
  const OFL_DIR = fileURLToPath(new URL('../../../ofl-data/fixtures', import.meta.url));
  const hasOflData = existsSync(join(OFL_DIR, 'manufacturers.json')) && existsSync(join(OFL_DIR, 'etc'));

  it.skipIf(!hasOflData)('finds a known fixture in the real OFL data', async () => {
    const manufacturers = JSON.parse(readFileSync(join(OFL_DIR, 'manufacturers.json'), 'utf8')) as Record<string, unknown>;
    /** Reads the fixture files of one manufacturer directory. */
    function* fileSource(manufacturerKey: string): Generator<OflFixtureEntry> {
      for (const file of readdirSync(join(OFL_DIR, manufacturerKey))) {
        if (!file.endsWith('.json')) continue;
        yield {
          fixtureKey: file.slice(0, -'.json'.length),
          json: JSON.parse(readFileSync(join(OFL_DIR, manufacturerKey, file), 'utf8')),
        };
      }
    }
    const scanned = vi.fn(fileSource);
    const keys = await findOflKeysByRdm(manufacturers, 25972, 513, scanned);
    expect(keys).toContain('etc/colorsource-par');
    expect(scanned.mock.calls.map(([mf]) => mf)).toEqual(['etc']);
  });
});

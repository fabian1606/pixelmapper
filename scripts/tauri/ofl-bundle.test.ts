// @vitest-environment node
/**
 * Pixelmapper's own fixture library (`fixture-library/`) and the desktop
 * bundle built from it: the X-Tubes are valid definitions with RDM IDs, build
 * into RGB pixel bars, and land in the bundle index's RDM table.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { OflFixtureSchema, OflManufacturersSchema } from '~/utils/ofl/schemas';
import { createFixtureFromOfl } from '~/utils/ofl/fixture-factory';
import type { OflLibraryIndex } from '~/utils/ofl/library-query';
import { buildOflBundle } from './ofl-bundle';

/** Repository's own fixture library. */
const OWN_LIBRARY = fileURLToPath(new URL('../../fixture-library', import.meta.url));

/** RDM manufacturer ID of the XB proxy (pixelmapper-hardware PM_XB_ESTA_MANUFACTURER). */
const XB_MANUFACTURER_ID = 0x7ff1;

/** Reads and parses a JSON file of the own library. */
async function readOwn(path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(OWN_LIBRARY, path), 'utf8'));
}

let outDir: string | null = null;

afterEach(async () => {
  if (outDir) await rm(outDir, { recursive: true, force: true });
  outDir = null;
});

describe('own fixture library', () => {
  it('maps the XB proxy manufacturer to its RDM ID', async () => {
    const manufacturers = OflManufacturersSchema.parse(await readOwn('manufacturers.json'));
    expect(manufacturers['botex-xb']?.rdmId).toBe(XB_MANUFACTURER_ID);
  });

  it.each([
    ['x-tube-500', 0x50, 6],
    ['x-tube-1000', 0xb0, 12],
  ])('%s: RDM model %i, personality 1 = %i RGB pixels', async (file, modelId, pixels) => {
    const definition = OflFixtureSchema.parse(await readOwn(`botex-xb/${file}.json`));
    expect(definition.rdm?.modelId).toBe(modelId);
    expect(definition.modes[0]?.rdmPersonalityIndex).toBe(1);

    const fixture = createFixtureFromOfl(definition, 0, 'test');
    expect(fixture.channels).toHaveLength(pixels * 3);
    // Per pixel R, G, B on consecutive addresses, one beam per pixel.
    expect(fixture.channels.slice(0, 6).map(ch => [String(ch.type), ch.addressOffset])).toEqual([
      ['RED', 0], ['GREEN', 1], ['BLUE', 2], ['RED', 3], ['GREEN', 4], ['BLUE', 5],
    ]);
    expect(fixture.beams).toHaveLength(pixels);
  });
});

describe('buildOflBundle', () => {
  it('overlays the own library and indexes its RDM IDs', async () => {
    outDir = await mkdtemp(join(tmpdir(), 'ofl-bundle-'));
    const stats = await buildOflBundle([join(outDir, 'missing-ofl'), OWN_LIBRARY], outDir);
    expect(stats?.fixtures).toBe(2);

    const index = JSON.parse(await readFile(join(outDir, 'ofl', 'index.json'), 'utf8')) as OflLibraryIndex;
    expect(index.manufacturers.map(m => m.key)).toEqual(['botex-xb']);
    expect(index.rdm).toEqual([
      { manufacturerId: XB_MANUFACTURER_ID, modelId: 0xb0, key: 'botex-xb/x-tube-1000' },
      { manufacturerId: XB_MANUFACTURER_ID, modelId: 0x50, key: 'botex-xb/x-tube-500' },
    ]);
  });

  it('returns null when no source dir exists', async () => {
    outDir = await mkdtemp(join(tmpdir(), 'ofl-bundle-'));
    expect(await buildOflBundle([join(outDir, 'nope')], outDir)).toBeNull();
  });
});

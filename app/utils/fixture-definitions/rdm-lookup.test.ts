import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OflFixture } from '~/utils/ofl/types';
import { customFixtureKey, saveCustomFixture } from './custom-fixtures';
import { useFreshCustomFixtureLibrary } from '~/utils/fixture-definitions/custom-fixtures.test-support';
import { setDefinitionFetcher } from './resolve-definition';
import { buildRdmDefinitionMatch, findFixtureDefinitionByRdm, setRdmLookupFetcher } from './rdm-lookup';
import xbar500Json from './__fixtures__/xbar500-rdm.json';

/** XBAR500 custom definition: RDM manufacturer 0x7FF0, model 1, personalities 1..4. */
const XBAR500 = xbar500Json as unknown as OflFixture;
/** RDM manufacturer ID of the XBAR500 custom firmware. */
const XBAR_MANUFACTURER_ID = 0x7ff0;

/** A synthetic OFL definition with a matrix insert, served by the fake fetcher. */
const ACME_PAR: OflFixture = {
  $schema: 'https://raw.githubusercontent.com/OpenLightingProject/open-fixture-library/master/schemas/fixture.json',
  name: 'Pixel Par',
  categories: ['Color Changer'],
  meta: { authors: ['test'], createDate: '2026-10-24', lastModifyDate: '2026-10-24' },
  rdm: { modelId: 7 },
  matrix: { pixelCount: [3, 1, 1] },
  availableChannels: {
    Dimmer: { capability: { type: 'Intensity' } },
  },
  templateChannels: {
    'Red $pixelKey': { capability: { type: 'ColorIntensity', color: 'Red' } },
    'Green $pixelKey': { capability: { type: 'ColorIntensity', color: 'Green' } },
  },
  modes: [
    { name: 'Dimmer', rdmPersonalityIndex: 2, channels: ['Dimmer'] },
    {
      name: 'Pixels',
      rdmPersonalityIndex: 1,
      channels: [
        'Dimmer',
        {
          insert: 'matrixChannels',
          repeatFor: 'eachPixelABC',
          channelOrder: 'perPixel',
          templateChannels: ['Red $pixelKey', 'Green $pixelKey'],
        },
      ],
    },
    { name: 'Legacy', channels: ['Dimmer'] },
  ],
} as OflFixture;

/** Route URL of the OFL RDM lookup. */
const rdmUrl = (manufacturerId: number, modelId: number) =>
  `/api/fixtures/rdm?manufacturerId=${manufacturerId}&modelId=${modelId}`;

/** Fake responses by URL; a function value is called (e.g. to throw). */
let routes: Record<string, unknown>;
/** URLs requested through the fake fetcher. */
let requested: string[];

/** Fake JSON fetcher over `routes`; unknown URLs fail like a missing route (404). */
async function fakeFetcher(url: string): Promise<unknown> {
  requested.push(url);
  if (!(url in routes)) throw new Error(`GET ${url} failed: 404`);
  const response = routes[url];
  return typeof response === 'function' ? (response as () => unknown)() : structuredClone(response);
}

describe('findFixtureDefinitionByRdm', () => {
  beforeEach(async () => {
    localStorage.clear();
    await useFreshCustomFixtureLibrary();
    requested = [];
    routes = {
      [rdmUrl(100, 7)]: { keys: ['acme/pixel-par', 'acme/pixel-par-2'] },
      '/api/fixtures/acme/pixel-par': ACME_PAR,
      '/api/fixtures?mode=manufacturers': [{ key: 'acme', name: 'ACME Lighting', fixtureCount: 2 }],
    };
    setDefinitionFetcher(fakeFetcher);
    setRdmLookupFetcher(fakeFetcher);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setDefinitionFetcher(null);
    setRdmLookupFetcher(null);
  });

  it('matches a custom fixture by rdmManufacturerId + rdm.modelId', async () => {
    const stored = (await saveCustomFixture(XBAR500))!;
    const match = await findFixtureDefinitionByRdm(XBAR_MANUFACTURER_ID, 1);
    expect(match).toMatchObject({
      key: customFixtureKey(stored),
      source: 'custom',
      name: 'XBAR500 LED Tube (custom fw)',
      manufacturer: '',
    });
    // No OFL request when a custom fixture matches.
    expect(requested).toEqual([]);
  });

  it('maps RDM personalities to modes and counts the channels of each mode', async () => {
    await saveCustomFixture(XBAR500);
    const match = await findFixtureDefinitionByRdm(XBAR_MANUFACTURER_ID, 1);
    expect(match?.modes).toEqual([
      { index: 0, name: '4x RGB (12 ch)', channelCount: 12, rdmPersonalityIndex: 1 },
      { index: 1, name: 'RGB (3 ch)', channelCount: 3, rdmPersonalityIndex: 2 },
      { index: 2, name: 'RGB + Dimmer (4 ch)', channelCount: 4, rdmPersonalityIndex: 3 },
      { index: 3, name: '4x RGB + Dimmer (13 ch)', channelCount: 13, rdmPersonalityIndex: 4 },
    ]);
    expect(match?.modeByPersonality).toEqual({ 1: 0, 2: 1, 3: 2, 4: 3 });
  });

  it('prefers custom fixtures over OFL fixtures with the same RDM IDs', async () => {
    const stored = (await saveCustomFixture({
      ...XBAR500,
      name: 'My Pixel Par',
      rdm: { modelId: 7 },
      pixelmapper: { rdmManufacturerId: 100 },
    }))!;
    const match = await findFixtureDefinitionByRdm(100, 7);
    expect(match).toMatchObject({ key: customFixtureKey(stored), source: 'custom', name: 'My Pixel Par' });
    expect(requested).toEqual([]);
  });

  it('takes the first matching custom fixture (newest first)', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1000);
    await saveCustomFixture({ ...XBAR500, name: 'Older XBAR' });
    now.mockReturnValue(2000);
    const newer = (await saveCustomFixture({ ...XBAR500, name: 'Newer XBAR' }))!;
    const match = await findFixtureDefinitionByRdm(XBAR_MANUFACTURER_ID, 1);
    expect(match).toMatchObject({ key: customFixtureKey(newer), name: 'Newer XBAR' });
  });

  it('falls back to the first OFL key from the route', async () => {
    // A custom fixture with other RDM IDs does not match.
    await saveCustomFixture(XBAR500);
    const match = await findFixtureDefinitionByRdm(100, 7);
    expect(match).toEqual({
      key: 'acme/pixel-par',
      source: 'ofl',
      name: 'Pixel Par',
      manufacturer: 'ACME Lighting',
      modes: [
        { index: 0, name: 'Dimmer', channelCount: 1, rdmPersonalityIndex: 2 },
        // Dimmer + 3 pixels × (Red, Green) from the matrix insert.
        { index: 1, name: 'Pixels', channelCount: 7, rdmPersonalityIndex: 1 },
        { index: 2, name: 'Legacy', channelCount: 1 },
      ],
      modeByPersonality: { 1: 1, 2: 0 },
    });
    expect(requested).toContain(rdmUrl(100, 7));
    expect(requested).toContain('/api/fixtures/acme/pixel-par');
    expect(requested).not.toContain('/api/fixtures/acme/pixel-par-2');
  });

  it('returns null when nothing matches', async () => {
    routes[rdmUrl(100, 8)] = { keys: [] };
    await expect(findFixtureDefinitionByRdm(100, 8)).resolves.toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('returns null for invalid IDs without any request', async () => {
    await saveCustomFixture(XBAR500);
    for (const [manufacturerId, modelId] of [[-1, 7], [100, 1.5], [0x10000, 7], [100, Number.NaN]] as const) {
      await expect(findFixtureDefinitionByRdm(manufacturerId, modelId)).resolves.toBeNull();
    }
    expect(requested).toEqual([]);
  });

  it('treats a failing or missing route as no OFL match', async () => {
    // Missing route (e.g. desktop SPA build without Nitro routes): 404.
    await expect(findFixtureDefinitionByRdm(300, 1)).resolves.toBeNull();
    // Network error.
    routes[rdmUrl(100, 9)] = () => { throw new TypeError('Failed to fetch'); };
    await expect(findFixtureDefinitionByRdm(100, 9)).resolves.toBeNull();
    // Malformed response.
    routes[rdmUrl(100, 10)] = { items: [] };
    await expect(findFixtureDefinitionByRdm(100, 10)).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(3);
  });

  it('retries the route after a failure', async () => {
    routes[rdmUrl(100, 7)] = () => { throw new TypeError('Failed to fetch'); };
    await expect(findFixtureDefinitionByRdm(100, 7)).resolves.toBeNull();
    routes[rdmUrl(100, 7)] = { keys: ['acme/pixel-par'] };
    await expect(findFixtureDefinitionByRdm(100, 7)).resolves.toMatchObject({ key: 'acme/pixel-par' });
  });

  it('still returns a custom match when the OFL route is unavailable', async () => {
    routes = {};
    await saveCustomFixture(XBAR500);
    await expect(findFixtureDefinitionByRdm(XBAR_MANUFACTURER_ID, 1)).resolves.toMatchObject({ source: 'custom' });
  });

  it('returns null when the OFL definition cannot be loaded', async () => {
    delete routes['/api/fixtures/acme/pixel-par'];
    await expect(findFixtureDefinitionByRdm(100, 7)).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('buildRdmDefinitionMatch', () => {
  it('keeps the first mode per personality and ignores invalid personalities', () => {
    const definition = {
      ...ACME_PAR,
      modes: [
        { name: 'A', rdmPersonalityIndex: 1, channels: ['Dimmer'] },
        { name: 'B', rdmPersonalityIndex: 1, channels: ['Dimmer'] },
        { name: 'C', rdmPersonalityIndex: 0, channels: ['Dimmer'] },
      ],
    } as OflFixture;
    const match = buildRdmDefinitionMatch('acme/pixel-par', 'ofl', definition, 'ACME');
    expect(match.modeByPersonality).toEqual({ 1: 0 });
    expect(match.modes.map(m => m.rdmPersonalityIndex)).toEqual([1, 1, undefined]);
    expect(match).toMatchObject({ key: 'acme/pixel-par', source: 'ofl', name: 'Pixel Par', manufacturer: 'ACME' });
  });
});

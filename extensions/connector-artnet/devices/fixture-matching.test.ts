/**
 * Matching cascade (plan M6.2, D10): lookup → generated → generic, with fake
 * dependencies, plus one run through the real host (custom fixture store,
 * RDM lookup and `commands.addFixtures`).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { Json, RdmDefinitionMatch } from '@pixelmapper/extension-api';
import { useEngineStore } from '~/stores/engine-store';
import { useHistory } from '~/components/engine/composables/use-history';
import { getCustomFixtures } from '~/utils/fixture-definitions/custom-fixtures';
import { useFreshCustomFixtureLibrary } from '~/utils/fixture-definitions/custom-fixtures.test-support';
import { setDefinitionFetcher } from '~/utils/fixture-definitions/resolve-definition';
import { setRdmLookupFetcher } from '~/utils/fixture-definitions/rdm-lookup';
import { createCoreCommandFactory } from '~/utils/extensions/core-command-factory';
import { installSharedGlobals } from '~/utils/extensions/shared-globals';
import { resetRegistry } from '~/utils/extensions/registry';
import { runAsExtension } from '~/utils/extensions/fixture-patch-observer';
import type { RdmDeviceInfo, RdmPersonality, RdmSlot } from '../bridge/protocol-model';
import { TUBE_FOOTPRINTS, makeDescription } from '../bridge/testing/fixtures';
import { NoDmxFootprintError, createDeviceMatcher, manufacturerIdOfUid } from './fixture-matching';
import type { MatchingDeps } from './fixture-matching';
import { generatedDefinitionMatch } from './fixture-generation';

const UID = '7FF0:74B6510C';

/** Slot of the spot below (primary unless `type` is given). */
const slot = (offset: number, labelId: number, defaultValue: number | null = null, type = 0, description: string | null = null): RdmSlot =>
  ({ offset, type, labelId, description, defaultValue });

/** An 11-slot spot: dimmer, RGB, 16-bit pan + pan speed, strobe, manufacturer slot, a second red, one undescribed slot. */
const SPOT_SLOTS: RdmSlot[] = [
  slot(0, 0x0001, 255), slot(1, 0x0205), slot(2, 0x0206), slot(3, 0x0207),
  slot(4, 0x0101, 128), slot(5, 4, 0, 0x01), slot(6, 4, null, 0x03),
  slot(7, 0x0404, 0, 0, 'Shutter'), slot(8, 0x8001, 7), slot(9, 0x0205),
];
const SPOT_PERSONALITIES: RdmPersonality[] = [
  { index: 1, footprint: 11, description: 'Spot' },
  { index: 2, footprint: 4, description: null },
  { index: 3, footprint: 0, description: 'RDM only' },
];
const SPOT_INFO: Partial<RdmDeviceInfo> = { deviceModelId: 0x42, dmxFootprint: 11, personalityCount: 3, productCategory: 0x0102 };

/** The spot's `rdmDescribe` result. */
const spot = (uid = UID) => makeDescription(uid, { slots: SPOT_SLOTS, personalities: SPOT_PERSONALITIES, deviceModelDescription: 'Spot 11' }, SPOT_INFO);

/** XBAR500 tube definition as the lookup returns it. */
function tubeMatch(overrides: Partial<RdmDefinitionMatch> = {}): RdmDefinitionMatch {
  return {
    key: 'custom/xbar', source: 'custom', name: 'XBAR500', manufacturer: '',
    modes: TUBE_FOOTPRINTS.map((n, i) => ({ index: i, name: `${n} ch`, channelCount: n, rdmPersonalityIndex: i + 1 })),
    modeByPersonality: { 1: 0, 2: 1, 3: 2, 4: 3 },
    ...overrides,
  };
}

/** Fake deps: lookup returns `found` or a stored definition with the same RDM IDs. */
function fakeDeps(found: RdmDefinitionMatch | null = null) {
  const saved: { key: string; definition: Json }[] = [];
  const ids = (d: Json) => d as unknown as { rdm: { modelId: number }; pixelmapper: { rdmManufacturerId: number } };
  const deps = {
    findByRdm: vi.fn(async (manufacturerId: number, modelId: number) => {
      const hit = saved.find(s => ids(s.definition).pixelmapper.rdmManufacturerId === manufacturerId && ids(s.definition).rdm.modelId === modelId);
      return hit ? generatedDefinitionMatch(hit.key, hit.definition) : found;
    }),
    saveDefinition: vi.fn((definition: Json) => {
      saved.push({ key: `custom/gen-${saved.length + 1}`, definition });
      return saved.at(-1)!.key;
    }),
  } satisfies MatchingDeps;
  return { deps, saved };
}

describe('manufacturerIdOfUid', () => {
  it('parses the manufacturer of a UID', () => {
    expect(manufacturerIdOfUid('7FF0:74B6510C')).toBe(0x7ff0);
    expect(manufacturerIdOfUid('02a0:00000001')).toBe(0x02a0);
    expect(() => manufacturerIdOfUid('7FF0-1')).toThrow('Invalid RDM UID');
  });
});

describe('step 1: lookup', () => {
  it('picks the mode of the current personality', async () => {
    const { deps } = fakeDeps(tubeMatch());
    const m = await createDeviceMatcher(deps).match(makeDescription(UID, {}, { currentPersonality: 3 }));
    expect(deps.findByRdm).toHaveBeenCalledWith(0x7ff0, 1);
    expect(deps.saveDefinition).not.toHaveBeenCalled();
    expect(m).toEqual({
      key: 'custom/xbar', modeIndex: 2, via: 'lookup', name: 'XBAR500', channelCount: 4,
      modeByPersonality: { 1: 0, 2: 1, 3: 2, 4: 3 }, personalityByMode: { 0: 1, 1: 2, 2: 3, 3: 4 }, warnings: [],
    });
  });

  it('falls back to the footprint, then mode 0, when the personality is not mapped', async () => {
    const modes = tubeMatch().modes.map(m => (m.index === 0 ? m : { ...m, rdmPersonalityIndex: undefined }));
    const { deps } = fakeDeps(tubeMatch({ modes, modeByPersonality: { 1: 0 } }));
    const matcher = createDeviceMatcher(deps);

    const byFootprint = await matcher.match(makeDescription(UID, {}, { currentPersonality: 4 }));
    expect(byFootprint).toMatchObject({ modeIndex: 3, channelCount: 13, personalityByMode: { 0: 1 } });
    expect(byFootprint.warnings).toEqual(['Personality 4 of the device has no mode in "XBAR500"; using mode "13 ch".']);

    const first = await matcher.match(makeDescription(UID, {}, { currentPersonality: 2, dmxFootprint: 7 }));
    expect(first.modeIndex).toBe(0);
    expect(first.warnings).toEqual([
      'Personality 2 of the device has no mode in "XBAR500"; using mode "12 ch".',
      'Mode "12 ch" has 12 channels, the device reports a DMX footprint of 7.',
    ]);
  });

  it('warns when the mode has fewer channels than the footprint (OFL null slots)', async () => {
    const modes = tubeMatch().modes.map(m => (m.index === 0 ? { ...m, channelCount: 10 } : m));
    const { deps } = fakeDeps(tubeMatch({ modes }));
    const m = await createDeviceMatcher(deps).match(makeDescription(UID));
    expect(m).toMatchObject({ modeIndex: 0, channelCount: 10 });
    expect(m.warnings).toEqual(['Mode "12 ch" has 10 channels, the device reports a DMX footprint of 12.']);
  });
});

describe('step 2: generated from slots', () => {
  it('stores one channel per slot and one mode per personality with the RDM IDs', async () => {
    const { deps, saved } = fakeDeps();
    const m = await createDeviceMatcher(deps).match(spot());
    expect(m).toEqual({
      key: 'custom/gen-1', modeIndex: 0, via: 'generated', name: 'Spot 11', channelCount: 11,
      modeByPersonality: { 1: 0, 2: 1 }, personalityByMode: { 0: 1, 1: 2 }, warnings: [],
    });
    const definition = saved[0]!.definition as Record<string, Json>;
    expect(definition).toMatchObject({
      name: 'Spot 11', categories: ['Moving Head'],
      rdm: { modelId: 0x42, softwareVersion: '0.5.0' }, pixelmapper: { rdmManufacturerId: 0x7ff0 },
    });
    expect(definition.modes).toEqual([
      {
        name: 'Spot', rdmPersonalityIndex: 1,
        channels: ['Dimmer', 'Red', 'Green', 'Blue', 'Pan', 'Pan fine', 'Pan Speed', 'Shutter', 'Channel 9', 'Red 2', 'Channel 11'],
      },
      { name: 'Personality 2', rdmPersonalityIndex: 2, channels: ['Channel 1', 'Channel 2', 'Channel 3', 'Channel 4'] },
    ]);
    const generic = { capability: { type: 'Generic' } };
    expect(definition.availableChannels).toEqual({
      'Dimmer': { capability: { type: 'Intensity' }, defaultValue: 255 },
      'Red': { capability: { type: 'ColorIntensity', color: 'Red' } },
      'Green': { capability: { type: 'ColorIntensity', color: 'Green' } },
      'Blue': { capability: { type: 'ColorIntensity', color: 'Blue' } },
      'Pan': { capability: { type: 'Pan' }, defaultValue: 128 * 256, fineChannelAliases: ['Pan fine'], dmxValueResolution: '16bit' },
      'Pan Speed': { capability: { type: 'PanTiltSpeed' } },
      'Shutter': { capability: { type: 'StrobeSpeed' }, defaultValue: 0 },
      'Channel 9': { ...generic, defaultValue: 7 },
      'Red 2': { capability: { type: 'ColorIntensity', color: 'Red' } },
      'Channel 11': generic,
      'Channel 1': generic, 'Channel 2': generic, 'Channel 3': generic, 'Channel 4': generic,
    });
  });

  it('handles 24-bit, unexpressible 16-bit defaults and fine slots without primary', async () => {
    const { deps, saved } = fakeDeps();
    const slots = [slot(0, 0x0102, 0), slot(1, 0, 0x80, 0x01), slot(2, 0, 1, 0x01), slot(3, 0x0101, 0), slot(4, 3, 5, 0x01), slot(5, 9, null, 0x01)];
    await createDeviceMatcher(deps).match(makeDescription(UID, { slots, personalities: [] }, { dmxFootprint: 6, currentPersonality: 1 }));
    const channels = (saved[0]!.definition as { availableChannels: Record<string, Json> }).availableChannels;
    expect(channels.Tilt).toMatchObject({ fineChannelAliases: ['Tilt fine', 'Tilt fine 2'], dmxValueResolution: '24bit', defaultValue: 0x8001 });
    expect(channels.Pan).toMatchObject({ fineChannelAliases: ['Pan fine'], defaultValue: 0 });
    expect(channels['Channel 6']).toEqual({ capability: { type: 'Generic' } });
  });

  it('falls back to generic channels when the generated definition is rejected', async () => {
    const { deps } = fakeDeps();
    deps.saveDefinition.mockImplementationOnce(() => { throw new Error('mode "Spot" cannot be built'); });
    const m = await createDeviceMatcher(deps).match(spot());
    expect(m).toMatchObject({ via: 'generic', key: 'custom/gen-1', channelCount: 11 });
    expect(m.warnings[0]).toContain('mode "Spot" cannot be built');
  });
});

describe('step 3: generic', () => {
  it('stores dimmer channels for every personality', async () => {
    const { deps, saved } = fakeDeps();
    const m = await createDeviceMatcher(deps).match(makeDescription(UID, {}, { currentPersonality: 4 }));
    expect(m).toMatchObject({ via: 'generic', modeIndex: 3, channelCount: 13, modeByPersonality: { 1: 0, 2: 1, 3: 2, 4: 3 }, warnings: [] });
    const definition = saved[0]!.definition as { modes: { name: string; channels: string[] }[]; availableChannels: Record<string, Json> };
    expect(definition.modes.map(mode => [mode.name, mode.channels.length])).toEqual([['12 ch', 12], ['3 ch', 3], ['4 ch', 4], ['13 ch', 13]]);
    expect(definition.modes[1]!.channels).toEqual(['Dimmer 1', 'Dimmer 2', 'Dimmer 3']);
    expect(Object.keys(definition.availableChannels)).toHaveLength(13);
    expect(definition.availableChannels['Dimmer 13']).toEqual({ capability: { type: 'Intensity' } });
  });

  it('makes one mode for the current personality without personality descriptions', async () => {
    const { deps, saved } = fakeDeps();
    const m = await createDeviceMatcher(deps).match(makeDescription(UID, { personalities: [], deviceModelDescription: null }, { currentPersonality: 2 }));
    expect(m).toMatchObject({ modeIndex: 0, channelCount: 3, modeByPersonality: { 2: 0 }, personalityByMode: { 0: 2 } });
    expect(saved[0]!.definition).toMatchObject({ name: 'RDM device 7FF0:0001', modes: [{ name: 'Personality 2', rdmPersonalityIndex: 2 }] });
  });
});

describe('dedupe and rejection', () => {
  it('stores one definition for concurrent matches of the same model', async () => {
    const { deps, saved } = fakeDeps();
    const matcher = createDeviceMatcher(deps);
    const uids = [1, 2, 3, 4].map(n => `7FF0:0000000${n}`);
    const results = await Promise.all([
      ...uids.map(uid => matcher.match(spot(uid))),
      matcher.match(makeDescription('7FF0:00000009', {}, { deviceModelId: 7 })),
    ]);
    expect(saved).toHaveLength(2);
    expect(results.map(r => [r.key, r.via])).toEqual([...uids.map(() => ['custom/gen-1', 'generated']), ['custom/gen-2', 'generic']]);
    // Settled: the next match finds the stored definition by lookup.
    expect(await matcher.match(spot('7FF0:00000005'))).toMatchObject({ key: 'custom/gen-1', via: 'lookup' });
    expect(saved).toHaveLength(2);
  });

  it('rejects devices without a DMX footprint', async () => {
    const { deps } = fakeDeps(tubeMatch());
    const matcher = createDeviceMatcher(deps);
    await expect(matcher.match(makeDescription(UID, {}, { dmxFootprint: 0 }))).rejects.toBeInstanceOf(NoDmxFootprintError);
    await expect(matcher.match(makeDescription(UID, {}, { dmxStartAddress: 0xffff }))).rejects.toThrow('The device has no DMX footprint');
    expect(deps.findByRdm).not.toHaveBeenCalled();
  });
});

describe('through the host', () => {
  beforeAll(() => {
    // The engine store spawns a worker in the browser; not needed here.
    vi.stubGlobal('Worker', class { postMessage() {} terminate() {} onmessage = null; onerror = null; });
    vi.stubGlobal('useSupabaseClient', () => ({}));
  });

  beforeEach(async () => {
    setActivePinia(createPinia());
    resetRegistry();
    installSharedGlobals();
    localStorage.clear();
    await useFreshCustomFixtureLibrary();
    setRdmLookupFetcher(async () => ({ keys: [] }));
    setDefinitionFetcher(async (url) => { throw new Error(`404 ${url}`); });
  });

  afterEach(() => {
    setRdmLookupFetcher(null);
    setDefinitionFetcher(null);
  });

  it('stores a generated definition whose fixture has one channel per slot, found by the next lookup', async () => {
    const m = await createDeviceMatcher().match(spot());
    expect(m).toMatchObject({ via: 'generated', modeIndex: 0, channelCount: 11 });
    expect(getCustomFixtures()).toHaveLength(1);

    const add = await createCoreCommandFactory('connector-artnet').addFixtures([{ definition: m.key, modeIndex: m.modeIndex, startAddress: 1 }]);
    runAsExtension('connector-artnet', () => useHistory().execute(add));
    const fixture = useEngineStore().flatFixtures.find(f => f.id === add.fixtureIds[0])!;
    expect(fixture.channels.map(c => c.addressOffset)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(fixture.channels.map(c => c.type)).toEqual([
      'DIMMER', 'RED', 'GREEN', 'BLUE', 'PAN', 'GENERIC', 'PANTILT_SPEED', 'STROBE_SPEED', 'GENERIC', 'RED', 'GENERIC',
    ]);
    expect(fixture.channels[4]).toMatchObject({ resolution: 2, fineAddressOffsets: [5], defaultValue: 128 });
    expect(fixture.channels[5]).toMatchObject({ isFine: true, defaultValue: 0 });
    expect(fixture.channels[8]!.defaultValue).toBe(7);

    const again = await createDeviceMatcher().match(spot('7FF0:00000002'));
    expect(again).toMatchObject({ via: 'lookup', key: m.key, modeIndex: 0, channelCount: 11, modeByPersonality: m.modeByPersonality, warnings: [] });
    expect(getCustomFixtures()).toHaveLength(1);
  });
});

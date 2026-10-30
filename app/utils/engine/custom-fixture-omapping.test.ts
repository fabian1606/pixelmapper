// @vitest-environment node
/**
 * Round-trip tests for the custom fixture editor mapping (plan M4.7):
 * OFL → `initFromOflFixture` (form) → `buildOflFixture` (save) must keep the
 * RDM identification and the per-pixel structure of imported definitions.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildOflFixture, initFromOflFixture } from './custom-fixture-omapping';
import { modeAddressCount } from './custom-fixture-channel-types';
import { parseOflFixtureJson } from '~/utils/fixture-definitions/ofl-import';
import { createFixtureFromOfl } from '~/utils/ofl/fixture-factory';
import type { OflFixture } from '~/utils/ofl/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Saves the editor state exactly like `CustomFixtureEditorDialog.handleSave` (no custom SVG). */
function buildFromInit(init: ReturnType<typeof initFromOflFixture>): OflFixture {
  return buildOflFixture(
    init.state, init.channels, init.modes, init.wheels,
    init.category, init.pixelCols, init.pixelRows,
    init.customSvgData, init.headToElementMap, init.headCount, init.useCustomSvg,
  );
}

/** Loads a definition into the editor and saves it again without edits. */
function roundTrip(ofl: OflFixture): OflFixture {
  return buildFromInit(initFromOflFixture(ofl));
}

/** Parses a JSON fixture file from `__fixtures__` through the import parser. */
function importFixtureFile(name: string): OflFixture {
  const text = readFileSync(
    fileURLToPath(new URL(`../fixture-definitions/__fixtures__/${name}`, import.meta.url)),
    'utf8',
  );
  const result = parseOflFixtureJson(text);
  if (!result.ok) throw new Error(result.error);
  return result.fixture;
}

/** Channel types of a mode, in DMX order. */
function channelTypes(ofl: OflFixture, modeIndex: number): string[] {
  return createFixtureFromOfl(ofl, modeIndex).channels.map(c => c.type);
}

/** A small single-head fixture with every RDM field set. */
const RDM_FIXTURE: OflFixture = {
  $schema: 'https://example.invalid/fixture.json',
  name: 'RDM Par',
  categories: ['Color Changer'],
  meta: { authors: ['Test'], createDate: '2026-01-01', lastModifyDate: '2026-01-01' },
  rdm: { modelId: 0x1234, softwareVersion: '2.1.0' },
  availableChannels: {
    Dimmer: { capability: { type: 'Intensity' } },
    Red: { capability: { type: 'ColorIntensity', color: 'Red' } },
  },
  modes: [
    { name: 'Dimmer', rdmPersonalityIndex: 1, channels: ['Dimmer'] },
    { name: 'Dimmer + Red', rdmPersonalityIndex: 2, channels: ['Dimmer', 'Red'] },
    { name: 'Red only', channels: ['Red'] },
  ],
  pixelmapper: { rdmManufacturerId: 0x7ff0 },
} as OflFixture;

// ── RDM fields ───────────────────────────────────────────────────────────────

describe('custom fixture mapping — RDM fields', () => {
  it('loads RDM IDs into the form state and personality indices into the modes', () => {
    const init = initFromOflFixture(RDM_FIXTURE);
    expect(init.state.rdmManufacturerId).toBe(0x7ff0);
    expect(init.state.rdmModelId).toBe(0x1234);
    expect(init.state.rdmSoftwareVersion).toBe('2.1.0');
    expect(init.modes.map(m => m.rdmPersonalityIndex)).toEqual([1, 2, undefined]);
  });

  it('round-trips manufacturer ID, model ID, software version and personality indices', () => {
    const saved = roundTrip(RDM_FIXTURE);
    expect(saved.pixelmapper?.rdmManufacturerId).toBe(0x7ff0);
    expect(saved.rdm).toEqual({ modelId: 0x1234, softwareVersion: '2.1.0' });
    expect(saved.modes.map(m => m.rdmPersonalityIndex)).toEqual([1, 2, undefined]);
    expect(saved.modes[2]).not.toHaveProperty('rdmPersonalityIndex');
  });

  it('writes RDM IDs entered in the form state into the saved definition', () => {
    const { rdm: _rdm, pixelmapper: _pixelmapper, ...plain } = RDM_FIXTURE;
    const init = initFromOflFixture(plain as OflFixture);
    expect(init.state.rdmManufacturerId).toBeNull();
    expect(init.state.rdmModelId).toBeNull();

    init.state.rdmManufacturerId = 0x7ff0;
    init.state.rdmModelId = 0x0042;
    init.modes[2]!.rdmPersonalityIndex = 3;
    const saved = buildFromInit(init);

    expect(saved.pixelmapper?.rdmManufacturerId).toBe(0x7ff0);
    expect(saved.rdm).toEqual({ modelId: 0x0042 });
    expect(saved.modes[2]!.rdmPersonalityIndex).toBe(3);
  });

  it('omits all RDM keys when the fields are empty', () => {
    const init = initFromOflFixture(RDM_FIXTURE);
    init.state.rdmManufacturerId = null;
    init.state.rdmModelId = null;
    for (const mode of init.modes) mode.rdmPersonalityIndex = undefined;
    const saved = buildFromInit(init);

    expect(saved).not.toHaveProperty('rdm');
    expect(saved.pixelmapper).not.toHaveProperty('rdmManufacturerId');
    for (const mode of saved.modes) expect(mode).not.toHaveProperty('rdmPersonalityIndex');
  });
});

// ── Explicit per-pixel channels ──────────────────────────────────────────────

describe('custom fixture mapping — explicit per-pixel channels', () => {
  /** Two-pixel strip whose modes list instantiated template channels. */
  function strip(channels: string[]): OflFixture {
    return {
      $schema: 'https://example.invalid/fixture.json',
      name: 'Strip',
      categories: ['Pixel Bar'],
      meta: { authors: ['Test'], createDate: '2026-01-01', lastModifyDate: '2026-01-01' },
      matrix: { pixelCount: [2, 1, 1] },
      templateChannels: {
        'Red $pixelKey': { capability: { type: 'ColorIntensity', color: 'Red' } },
        'Green $pixelKey': { capability: { type: 'ColorIntensity', color: 'Green' } },
      },
      modes: [{ name: 'Mode', channels }],
    } as OflFixture;
  }

  it('folds a per-channel ordered run into one per-head group', () => {
    const ofl = strip(['Red 1', 'Red 2', 'Green 1', 'Green 2']);
    const init = initFromOflFixture(ofl);
    expect(init.modes[0]!.entries.map(e => [e.perHead, e.order])).toEqual([
      [true, 'perChannel'],
      [true, 'perChannel'],
    ]);

    const saved = buildFromInit(init);
    expect(Object.keys(saved.templateChannels ?? {})).toEqual(['Red $pixelKey', 'Green $pixelKey']);
    expect(channelTypes(saved, 0)).toEqual(channelTypes(ofl, 0));
    expect(channelTypes(saved, 0)).toEqual(['RED', 'RED', 'GREEN', 'GREEN']);
  });

  it('keeps an irregular run as individual global channels', () => {
    const ofl = strip(['Red 1', 'Green 2']);
    const init = initFromOflFixture(ofl);
    expect(init.modes[0]!.entries.every(e => !e.perHead)).toBe(true);
    const names = init.modes[0]!.entries.map(e => init.channels.find(c => c.id === e.channelId)?.name);
    expect(names).toEqual(['Red 1', 'Green 2']);
    expect(channelTypes(buildFromInit(init), 0)).toEqual(['RED', 'GREEN']);
  });
});

// ── 16-bit channels (fineChannelAliases) ─────────────────────────────────────

/** DMX layout of a mode as the core builds it: one row per channel, in DMX order. */
function dmxLayout(ofl: OflFixture, modeIndex: number) {
  return createFixtureFromOfl(ofl, modeIndex).channels.map(c => ({
    name: c.oflChannelName,
    type: c.type,
    offset: c.addressOffset,
    isFine: c.isFine ?? false,
    fineOffsets: c.fineAddressOffsets ?? [],
    defaultValue: c.defaultValue,
  }));
}

/** Asserts that the editor shows as many DMX addresses per mode as the core uses. */
function expectEditorFootprint(ofl: OflFixture): void {
  const init = initFromOflFixture(ofl);
  init.modes.forEach((mode, i) => {
    expect(modeAddressCount(mode, init.channels, init.headCount)).toBe(createFixtureFromOfl(ofl, i).channels.length);
  });
}

/** `fineChannelAliases` of every channel that has some, by channel key. */
function fineAliases(channels: OflFixture['availableChannels']): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(channels ?? {})
      .filter(([, ch]) => ch.fineChannelAliases?.length)
      .map(([key, ch]) => [key, ch.fineChannelAliases!]),
  );
}

/** Moving head with 16-bit Pan / Tilt and a plain 8-bit channel after them. */
function mover(modes: OflFixture['modes'], extra: OflFixture['availableChannels'] = {}): OflFixture {
  return {
    $schema: 'https://example.invalid/fixture.json',
    name: 'Mover',
    categories: ['Moving Head'],
    meta: { authors: ['Test'], createDate: '2026-01-01', lastModifyDate: '2026-01-01' },
    availableChannels: {
      'Pan': { fineChannelAliases: ['Pan fine'], dmxValueResolution: '16bit', defaultValue: 32768, capability: { type: 'Pan', angleStart: '0deg', angleEnd: '540deg' } },
      'Tilt': { fineChannelAliases: ['Tilt LSB'], dmxValueResolution: '16bit', capability: { type: 'Tilt', angleStart: '0deg', angleEnd: '270deg' } },
      'Dimmer': { capability: { type: 'Intensity' } },
      ...extra,
    },
    modes,
  } as OflFixture;
}

describe('custom fixture mapping — 16-bit channels', () => {
  it('keeps fine aliases and DMX offsets when the fine bytes follow their coarse channels', () => {
    const ofl = mover([{ name: '16-bit', channels: ['Pan', 'Pan fine', 'Tilt', 'Tilt LSB', 'Dimmer'] }]);
    const init = initFromOflFixture(ofl);
    // The editor models coarse + fine as one '16bit' channel (2 addresses).
    expect(init.channels.map(c => [c.name, c.resolution])).toEqual([
      ['Pan', '16bit'], ['Tilt', '16bit'], ['Dimmer', '8bit'],
    ]);
    expect(init.modes[0]!.entries).toHaveLength(3);

    const saved = buildFromInit(init);
    expect(fineAliases(saved.availableChannels)).toEqual({ Pan: ['Pan fine'], Tilt: ['Tilt LSB'] });
    expect(saved.modes[0]!.channels).toEqual(ofl.modes[0]!.channels);

    const layout = dmxLayout(saved, 0);
    expect(layout).toEqual(dmxLayout(ofl, 0));
    // Pan fine byte at offset 1, Tilt at 2 (fine at 3), Dimmer right after at 4.
    expect(layout.map(c => [c.name, c.offset, c.isFine, c.fineOffsets])).toEqual([
      ['Pan', 0, false, [1]],
      ['Pan fine', 1, true, []],
      ['Tilt', 2, false, [3]],
      ['Tilt LSB', 3, true, []],
      ['Dimmer', 4, false, []],
    ]);
    expectEditorFootprint(ofl);
  });

  it('survives a second edit + save unchanged', () => {
    const ofl = mover([{ name: '16-bit', channels: ['Pan', 'Pan fine', 'Tilt', 'Tilt LSB', 'Dimmer'] }]);
    const twice = roundTrip(roundTrip(ofl));
    expect(fineAliases(twice.availableChannels)).toEqual({ Pan: ['Pan fine'], Tilt: ['Tilt LSB'] });
    expect(dmxLayout(twice, 0)).toEqual(dmxLayout(ofl, 0));
  });

  it('keeps every mode when a mode lists a fine alias apart from its coarse channel', () => {
    const ofl = mover(
      [
        { name: '8-bit', channels: ['Pan', 'Tilt', 'Dimmer'] },
        { name: 'Split', channels: ['Pan', 'Tilt', 'Pan fine', 'Tilt LSB', 'Dimmer'] },
        { name: '24-bit zoom', channels: ['Dimmer', 'Zoom', 'Zoom fine', 'Zoom fine 2', 'Pan', 'Pan fine'] },
      ],
      { Zoom: { fineChannelAliases: ['Zoom fine', 'Zoom fine 2'], dmxValueResolution: '24bit', capability: { type: 'Zoom', angleStart: '10deg', angleEnd: '40deg' } } },
    );
    const saved = roundTrip(ofl);

    expect(fineAliases(saved.availableChannels)).toEqual({
      Pan: ['Pan fine'], Tilt: ['Tilt LSB'], Zoom: ['Zoom fine', 'Zoom fine 2'],
    });
    expect(saved.availableChannels?.Zoom?.dmxValueResolution).toBe('24bit');
    // Fine aliases are no channels of their own.
    expect(Object.keys(saved.availableChannels ?? {})).toEqual(['Pan', 'Tilt', 'Dimmer', 'Zoom']);
    for (let i = 0; i < ofl.modes.length; i++) {
      expect(saved.modes[i]!.channels).toEqual(ofl.modes[i]!.channels);
      expect(dmxLayout(saved, i)).toEqual(dmxLayout(ofl, i));
    }
    // Split mode: the fine bytes stay behind Tilt, Dimmer stays at offset 4.
    expect(dmxLayout(saved, 1).map(c => [c.name, c.offset, c.fineOffsets])).toEqual([
      ['Pan', 0, [2]], ['Tilt', 1, [3]], ['Pan fine', 2, []], ['Tilt LSB', 3, []], ['Dimmer', 4, []],
    ]);
    expectEditorFootprint(ofl);
  });

  it('keeps fine aliases of per-pixel template channels', () => {
    const ofl = {
      $schema: 'https://example.invalid/fixture.json',
      name: 'Bar',
      categories: ['Pixel Bar'],
      meta: { authors: ['Test'], createDate: '2026-01-01', lastModifyDate: '2026-01-01' },
      // The editor's own pixel keys, so channel names compare 1:1 after the save.
      matrix: { pixelCount: [2, 1, 1], pixelKeys: [[['head-1', 'head-2']]] },
      availableChannels: { Strobe: { capability: { type: 'ShutterStrobe', shutterEffect: 'Strobe' } } },
      templateChannels: {
        'Dimmer $pixelKey': { fineChannelAliases: ['Dimmer fine $pixelKey'], dmxValueResolution: '16bit', capability: { type: 'Intensity' } },
        'Red $pixelKey': { capability: { type: 'ColorIntensity', color: 'Red' } },
      },
      modes: [{
        name: 'Pixels',
        channels: [
          { insert: 'matrixChannels', repeatFor: 'eachPixelABC', channelOrder: 'perPixel', templateChannels: ['Dimmer $pixelKey', 'Dimmer fine $pixelKey', 'Red $pixelKey'] },
          'Strobe',
        ],
      }],
    } as OflFixture;
    const saved = roundTrip(ofl);

    expect(saved.templateChannels?.['Dimmer $pixelKey']?.fineChannelAliases).toEqual(['Dimmer fine $pixelKey']);
    expect(dmxLayout(saved, 0)).toEqual(dmxLayout(ofl, 0));
    // Per pixel: Dimmer, Dimmer fine, Red → Strobe after both pixels at offset 6.
    expect(dmxLayout(saved, 0).map(c => [c.name, c.offset, c.fineOffsets])).toEqual([
      ['Dimmer head-1', 0, [1]], ['Dimmer fine head-1', 1, []], ['Red head-1', 2, []],
      ['Dimmer head-2', 3, [4]], ['Dimmer fine head-2', 4, []], ['Red head-2', 5, []],
      ['Strobe', 6, []],
    ]);
    expectEditorFootprint(ofl);
  });

  it('gives a 16-bit channel created in the editor the two addresses the editor shows', () => {
    const init = initFromOflFixture(mover([{ name: 'Mode', channels: ['Dimmer'] }]));
    const pan = init.channels.find(c => c.name === 'Pan')!;
    // Add Pan (16-bit) in front of Dimmer, like the mode editor does.
    init.modes[0]!.entries.unshift({ entryId: 'e-pan', channelId: pan.id, perHead: false, order: 'perPixel' });
    pan.name = 'Head Pan';
    const saved = buildFromInit(init);

    expect(saved.availableChannels?.['Head Pan']?.fineChannelAliases).toEqual(['Head Pan fine']);
    expect(dmxLayout(saved, 0).map(c => [c.name, c.offset, c.isFine, c.fineOffsets])).toEqual([
      ['Head Pan', 0, false, [1]], ['Head Pan fine', 1, true, []], ['Dimmer', 2, false, []],
    ]);
  });
});

// ── XBAR500 reference definition ─────────────────────────────────────────────

describe('custom fixture mapping — xbar500-custom.json round trip', () => {
  const original = importFixtureFile('xbar500-custom.json');
  const saved = roundTrip(original);

  it('keeps the RDM model ID and software version', () => {
    expect(saved.rdm?.modelId).toBe(1);
    expect(saved.rdm?.softwareVersion).toBe('0.5.0');
  });

  it('keeps mode names and RDM personality indices 1..4', () => {
    expect(saved.modes.map(m => m.name)).toEqual(original.modes.map(m => m.name));
    expect(saved.modes.map(m => m.rdmPersonalityIndex)).toEqual([1, 2, 3, 4]);
  });

  it('keeps template channels and the 4×1 pixel matrix', () => {
    expect(Object.keys(saved.templateChannels ?? {})).toEqual(['Red $pixelKey', 'Green $pixelKey', 'Blue $pixelKey']);
    expect(Object.keys(saved.availableChannels ?? {})).toEqual(['Red', 'Green', 'Blue', 'Dimmer']);
    expect(saved.matrix?.pixelCount).toEqual([4, 1, 1]);
    expect(saved.availableChannels?.Dimmer?.defaultValue).toBe(255);
  });

  it('yields 12 / 3 / 4 / 13 channels for modes 0..3', () => {
    const counts = saved.modes.map((_, i) => createFixtureFromOfl(saved, i).channels.length);
    expect(counts).toEqual([12, 3, 4, 13]);
  });

  it('keeps channel types in DMX order and one RGB triple per pixel', () => {
    for (let i = 0; i < original.modes.length; i++) {
      expect(channelTypes(saved, i)).toEqual(channelTypes(original, i));
    }
    const fixture = createFixtureFromOfl(saved, 0);
    expect(fixture.beams).toHaveLength(4);
    const beamIds = fixture.beams.map(b => b.id);
    // perPixel order: R G B of pixel 1, then pixel 2, …
    expect(fixture.channels.map(c => c.beamId)).toEqual(beamIds.flatMap(id => [id, id, id]));
  });
});

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

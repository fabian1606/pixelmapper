// @vitest-environment node
/**
 * Tests for the lenient OFL JSON parser of the custom fixture import (M4.7).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  OFL_FIXTURE_SCHEMA_URL,
  OFL_IMPORT_DEFAULT_AUTHOR,
  OFL_IMPORT_DEFAULT_CATEGORY,
  parseOflFixtureJson,
} from './ofl-import';

/** Raw text of the XBAR500 reference definition (copy of the device repo file). */
const XBAR500_TEXT = readFileSync(
  fileURLToPath(new URL('./__fixtures__/xbar500-custom.json', import.meta.url)),
  'utf8',
);

/** Smallest fixture the importer accepts: name, one mode, one channel map. */
const MINIMAL = {
  name: 'Minimal Par',
  availableChannels: { Dimmer: { capability: { type: 'Intensity' } } },
  modes: [{ name: '1ch', channels: ['Dimmer'] }],
};

/** Parses `value` as JSON text and asserts failure; returns the error. */
function expectError(value: unknown): string {
  const result = parseOflFixtureJson(typeof value === 'string' ? value : JSON.stringify(value));
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.error;
}

describe('parseOflFixtureJson', () => {
  it('accepts a complete OFL fixture and keeps its content', () => {
    const result = parseOflFixtureJson(XBAR500_TEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { fixture } = result;
    expect(fixture.name).toBe('XBAR500 LED Tube (custom fw)');
    expect(fixture.categories).toEqual(['Pixel Bar']);
    expect(fixture.meta.authors).toEqual(['HfG Schwaebisch Gmuend Prototyping Lab']);
    expect(fixture.rdm).toEqual({ modelId: 1, softwareVersion: '0.5.0' });
    expect(fixture.matrix?.pixelCount).toEqual([4, 1, 1]);
    expect(Object.keys(fixture.templateChannels ?? {})).toEqual(['Red $pixelKey', 'Green $pixelKey', 'Blue $pixelKey']);
    expect(fixture.modes.map(m => m.rdmPersonalityIndex)).toEqual([1, 2, 3, 4]);
  });

  it('rejects text that is not JSON with a readable message', () => {
    expect(expectError('{ "name": "Broken", ')).toMatch(/not valid JSON/);
  });

  it('rejects JSON that is not a fixture object', () => {
    expect(expectError([MINIMAL])).toMatch(/does not contain an OFL fixture object/);
    expect(expectError('42')).toMatch(/does not contain an OFL fixture object/);
  });

  it('requires a name', () => {
    expect(expectError({ ...MINIMAL, name: '  ' })).toMatch(/"name"/);
  });

  it('requires a non-empty modes array', () => {
    const { modes: _modes, ...withoutModes } = MINIMAL;
    expect(expectError(withoutModes)).toMatch(/non-empty "modes" array/);
    expect(expectError({ ...MINIMAL, modes: [] })).toMatch(/non-empty "modes" array/);
  });

  it('requires channels in every mode', () => {
    const error = expectError({ ...MINIMAL, modes: [MINIMAL.modes[0], { name: 'Broken' }] });
    expect(error).toMatch(/Mode "Broken" has no "channels" array/);
  });

  it('requires availableChannels and/or templateChannels', () => {
    const { availableChannels: _channels, ...withoutChannels } = MINIMAL;
    expect(expectError(withoutChannels)).toMatch(/"availableChannels" and\/or "templateChannels"/);
    expect(expectError({ ...MINIMAL, templateChannels: ['Red'] })).toMatch(/"templateChannels" must be an object/);
  });

  it('accepts a fixture with only templateChannels', () => {
    const result = parseOflFixtureJson(JSON.stringify({
      name: 'Pixel Strip',
      templateChannels: { 'Red $pixelKey': { capability: { type: 'ColorIntensity', color: 'Red' } } },
      matrix: { pixelCount: [2, 1, 1] },
      modes: [{ name: '2ch', channels: ['Red 1', 'Red 2'] }],
    }));
    expect(result.ok).toBe(true);
  });

  it('fills $schema, meta, categories and mode names with defaults', () => {
    const result = parseOflFixtureJson(JSON.stringify({
      ...MINIMAL,
      modes: [{ channels: ['Dimmer'] }],
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { fixture } = result;
    expect(fixture.$schema).toBe(OFL_FIXTURE_SCHEMA_URL);
    expect(fixture.categories).toEqual([OFL_IMPORT_DEFAULT_CATEGORY]);
    expect(fixture.meta.authors).toEqual([OFL_IMPORT_DEFAULT_AUTHOR]);
    expect(fixture.meta.createDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fixture.meta.lastModifyDate).toBe(fixture.meta.createDate);
    expect(fixture.modes[0]!.name).toBe('Mode 1');
  });

  it('completes a partial meta block without losing its fields', () => {
    const result = parseOflFixtureJson(JSON.stringify({ ...MINIMAL, meta: { createDate: '2020-01-02' } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fixture.meta).toEqual({
      authors: [OFL_IMPORT_DEFAULT_AUTHOR],
      createDate: '2020-01-02',
      lastModifyDate: '2020-01-02',
    });
  });

  it('drops malformed optional RDM data instead of failing', () => {
    const result = parseOflFixtureJson(JSON.stringify({
      ...MINIMAL,
      rdm: { modelId: 'one' },
      pixelmapper: { rdmManufacturerId: 0x1_0000, headLayout: { headCount: 1 } },
      modes: [{ name: '1ch', rdmPersonalityIndex: 0, channels: ['Dimmer'] }],
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fixture).not.toHaveProperty('rdm');
    expect(result.fixture.pixelmapper).toEqual({ headLayout: { headCount: 1 } });
    expect(result.fixture.modes[0]).not.toHaveProperty('rdmPersonalityIndex');
  });

  it('keeps a valid RDM manufacturer ID in the pixelmapper block', () => {
    const result = parseOflFixtureJson(JSON.stringify({ ...MINIMAL, pixelmapper: { rdmManufacturerId: 0x7ff0 } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fixture.pixelmapper?.rdmManufacturerId).toBe(0x7ff0);
  });
});

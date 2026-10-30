/**
 * Definition keys, the custom fixture accessor (plan M4.7) and definition
 * resolution / fixture building (M4.1, M4.3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OflFixture } from '~/utils/ofl/types';
import { customDefinitionKey, isCustomDefinitionKey, parseDefinitionKey } from './definition-keys';
import { customFixtureKey, getCustomFixture, getCustomFixtures, removeCustomFixture, saveCustomFixture } from './custom-fixtures';
import { useFreshCustomFixtureLibrary } from '~/utils/fixture-definitions/custom-fixtures.test-support';
import { createFixtureFromDefinition, resolveFixtureDefinition, setDefinitionFetcher } from './resolve-definition';
import { carryChannelValues } from './fixture-mode';
import xbar500 from './__fixtures__/xbar500-custom.json';

const XBAR = xbar500 as unknown as OflFixture;

beforeEach(async () => {
  localStorage.clear();
  await useFreshCustomFixtureLibrary();
});
afterEach(() => setDefinitionFetcher(null));

describe('definition keys', () => {
  it('parses OFL and custom keys', () => {
    expect(parseDefinitionKey('cameo/flat-pro-18')).toEqual({ source: 'ofl', manufacturer: 'cameo', fixture: 'flat-pro-18' });
    expect(parseDefinitionKey(customDefinitionKey('custom-1'))).toEqual({ source: 'custom', id: 'custom-1' });
    expect(isCustomDefinitionKey('custom/x')).toBe(true);
    for (const bad of ['', 'cameo', 'a/b/c', 'custom/', '/x']) expect(parseDefinitionKey(bad)).toBeNull();
  });
});

describe('custom fixture accessor', () => {
  it('saves (UUID identity, upsert by id), lists newest first, reads and removes', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1000);
    const first = (await saveCustomFixture({ ...XBAR, name: 'One' }))!;
    now.mockReturnValue(2000);
    const second = (await saveCustomFixture({ ...XBAR, name: 'Two' }))!;
    now.mockRestore();
    expect(getCustomFixtures().map(c => c.name)).toEqual(['Two', 'One']);
    // Same name without an id: a new entry, not an update.
    const twin = (await saveCustomFixture({ ...XBAR, name: 'One' }))!;
    expect(twin.id).not.toBe(first.id);
    await removeCustomFixture(twin.id);
    // With the id: replaces the entry, keeps its creation time (position).
    const updated = (await saveCustomFixture({ ...XBAR, name: 'One', shortName: 'v2' }, first.id))!;
    expect(updated).toMatchObject({ id: first.id, createdAt: 1000 });
    expect(getCustomFixture(first.id)?.ofl.shortName).toBe('v2');
    expect(customFixtureKey(second)).toBe(`custom/${second.id}`);
    await removeCustomFixture(second.id);
    expect(getCustomFixtures().map(c => c.name)).toEqual(['One']);
  });

  it('round-trips the RDM fields through the record', async () => {
    const ofl = { ...XBAR, rdm: { modelId: 5 }, pixelmapper: { rdmManufacturerId: 0x7ff0 } } as OflFixture;
    const stored = (await saveCustomFixture(ofl))!;
    expect(getCustomFixture(stored.id)?.ofl).toMatchObject({ rdm: { modelId: 5 }, pixelmapper: { rdmManufacturerId: 0x7ff0 } });
  });
});

describe('resolveFixtureDefinition / createFixtureFromDefinition', () => {
  it('resolves custom fixtures and records the source', async () => {
    const key = customFixtureKey((await saveCustomFixture(XBAR))!);
    const resolved = (await resolveFixtureDefinition(key))!;
    expect(resolved.definition.name).toBe(XBAR.name);
    const fixture = createFixtureFromDefinition(resolved, 3);
    expect(fixture.channels).toHaveLength(13);
    expect(fixture.source).toEqual({ key, modeIndex: 3 });
    expect(fixture.oflKey).toBeUndefined();
    expect(() => createFixtureFromDefinition(resolved, 4)).toThrow('no mode 4');
  });

  it('loads OFL definitions once and resolves the manufacturer name', async () => {
    const calls: string[] = [];
    setDefinitionFetcher(async (url) => {
      calls.push(url);
      if (url === '/api/fixtures/acme/tube') return XBAR;
      if (url.startsWith('/api/fixtures?mode=manufacturers')) return [{ key: 'acme', name: 'ACME' }];
      throw new Error('404');
    });
    const [a, b] = await Promise.all([resolveFixtureDefinition('acme/tube'), resolveFixtureDefinition('acme/tube')]);
    expect(a?.manufacturer).toBe('ACME');
    expect(b?.definition).toBe(a?.definition);
    expect(calls.filter(u => u === '/api/fixtures/acme/tube')).toHaveLength(1);
    const fixture = createFixtureFromDefinition(a!, 0);
    expect(fixture.oflKey).toBe('acme/tube');
    expect(fixture.manufacturer).toBe('ACME');
    expect(await resolveFixtureDefinition('acme/missing')).toBeNull();
    expect(await resolveFixtureDefinition('custom/missing')).toBeNull();
  });
});

describe('carryChannelValues', () => {
  it('copies programmed values per head and channel type', async () => {
    const key = customFixtureKey((await saveCustomFixture(XBAR))!);
    const resolved = (await resolveFixtureDefinition(key))!;
    const from = createFixtureFromDefinition(resolved, 0); // 4×RGB
    const to = createFixtureFromDefinition(resolved, 3); // 4×RGB + Dimmer
    from.channels.forEach((c, i) => { c.chaserConfig!.stepValues[0] = i + 1; c.rangeMax = 200; });
    carryChannelValues(from.channels, to.channels);
    expect(to.channels.slice(0, 12).map(c => c.chaserConfig!.stepValues[0])).toEqual(from.channels.map((_, i) => i + 1));
    expect(to.channels[0]!.rangeMax).toBe(200);
    // The dimmer has no counterpart and keeps its default.
    expect(to.channels[12]!.rangeMax).not.toBe(200);
    // Copies, not shared objects.
    expect(to.channels[0]!.chaserConfig).not.toBe(from.channels[0]!.chaserConfig);
  });
});

// @vitest-environment node
/**
 * Shared OFL queries (ADR 0004 D18): summaries, filtering and paging must
 * match the semantics of `GET /api/fixtures` on both platforms.
 */
import { describe, expect, it } from 'vitest';
import type { FixtureSummary, OflFixture } from './types';
import { buildFixtureSummary, queryFixtures, sortByName } from './library-query';

/** A minimal fixture with one 3-channel mode whose last channel is a fine alias. */
const FIXTURE = {
  name: 'Spot',
  shortName: 'SP',
  categories: ['Moving Head'],
  availableChannels: { Pan: { fineChannelAliases: ['Pan fine'] }, Dimmer: {} },
  modes: [{ name: '3ch', shortName: '3', channels: ['Pan', 'Dimmer', 'Pan fine', null] }],
} as unknown as OflFixture;

/** Summary factory for query tests. */
function summary(name: string, mf: string, categories: string[]): FixtureSummary {
  return { key: `${mf}/${name}`, manufacturer: mf, manufacturerKey: mf, name, shortName: name, categories, modes: [] };
}

const ALL = sortByName([
  summary('Zeta Par', 'acme', ['Color Changer']),
  summary('Alpha Spot', 'acme', ['Moving Head']),
  summary('Beam', 'other', ['Moving Head', 'Effect']),
]);

describe('buildFixtureSummary', () => {
  it('counts channels without fine aliases and skips redirects', () => {
    const s = buildFixtureSummary('acme', 'ACME', 'spot', FIXTURE);
    expect(s?.key).toBe('acme/spot');
    expect(s?.manufacturer).toBe('ACME');
    expect(s?.modes[0]?.channelCount).toBe(2);
    expect(buildFixtureSummary('acme', 'ACME', 'old', { name: 'x' } as unknown as OflFixture)).toBeNull();
  });
});

describe('queryFixtures', () => {
  it('returns one manufacturer unpaginated', () => {
    const page = queryFixtures(ALL, { manufacturer: 'acme' });
    expect(page.items.map(f => f.name)).toEqual(['Alpha Spot', 'Zeta Par']);
    expect(page).toMatchObject({ total: 2, offset: 0, limit: 2 });
  });

  it('searches across manufacturers and pages', () => {
    const page = queryFixtures(ALL, { category: 'moving', limit: 1, offset: 1, manufacturer: 'acme' });
    expect(page.total).toBe(2);
    expect(page.items.map(f => f.name)).toEqual(['Beam']);
    expect(page).toMatchObject({ offset: 1, limit: 1 });
  });

  it('matches name substrings case-insensitively', () => {
    expect(queryFixtures(ALL, { search: 'SPOT' }).items.map(f => f.name)).toEqual(['Alpha Spot']);
  });
});

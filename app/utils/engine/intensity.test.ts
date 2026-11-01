/** Intensity layer: which slots master / group dimmers scale, and the packet. */
import { describe, expect, it } from 'vitest';
import type { Fixture } from '~/utils/engine/core/fixture';
import { buildIntensityEntries, encodeIntensity, intensitySlots } from './intensity';

/** Minimal fixture with the given channel roles at consecutive offsets. */
function fixture(id: string, startAddress: number, roles: string[]): Fixture {
  return {
    id,
    startAddress,
    channels: roles.map((role, addressOffset) => ({ role, addressOffset })),
  } as unknown as Fixture;
}

describe('intensitySlots', () => {
  it('uses only the DIMMER channel when the fixture has one', () => {
    expect(intensitySlots(fixture('a', 1, ['COLOR', 'COLOR', 'COLOR', 'DIMMER']))).toEqual([3]);
  });

  it('uses the COLOR channels of RGB-only fixtures', () => {
    expect(intensitySlots(fixture('a', 11, ['COLOR', 'COLOR', 'COLOR', 'NONE']))).toEqual([10, 11, 12]);
  });
});

describe('buildIntensityEntries', () => {
  const bar = fixture('bar', 1, ['COLOR', 'COLOR', 'COLOR']);
  const spot = fixture('spot', 4, ['DIMMER', 'COLOR']);

  it('is empty at full levels (nothing to send)', () => {
    expect(buildIntensityEntries([bar, spot], 1, [{ fixtureIds: ['bar'], level: 1 }])).toEqual([]);
  });

  it('scales every color channel of a group by the same factor (no hue shift)', () => {
    expect(buildIntensityEntries([bar, spot], 1, [{ fixtureIds: ['bar'], level: 0.5 }]))
      .toEqual([[0, 0.5], [1, 0.5], [2, 0.5]]);
  });

  it('multiplies master and overlapping groups', () => {
    const groups = [{ fixtureIds: ['spot'], level: 0.5 }, { fixtureIds: ['spot', 'bar'], level: 0.5 }];
    expect(buildIntensityEntries([bar, spot], 0.8, groups)).toEqual([
      [0, 0.4], [1, 0.4], [2, 0.4],
      [3, 0.2],
    ]);
  });
});

describe('encodeIntensity', () => {
  it('writes u32 count, then u32 index + f32 factor per entry', () => {
    const view = new DataView(encodeIntensity([[513, 0.25]]).buffer);
    expect(view.getUint32(0, true)).toBe(1);
    expect(view.getUint32(4, true)).toBe(513);
    expect(view.getFloat32(8, true)).toBe(0.25);
  });
});

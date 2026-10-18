// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { channelUpdateKey, colorOverrideKey, fixtureDragKey, modifierUpdateKey } from '~/composables/live-ops/coalesce-keys';

describe('live-op coalesce keys', () => {
  it('modifier.update: per modifier and touched fields', () => {
    const a = modifierUpdateKey({ effectId: 'm1', changes: { angle: 1 } });
    expect(modifierUpdateKey({ effectId: 'm2', changes: { angle: 1 } })).not.toBe(a);
    expect(modifierUpdateKey({ effectId: 'm1', changes: { strength: 1 } })).not.toBe(a);
    expect(modifierUpdateKey({ effectId: 'm1', changes: { angle: 9 } })).toBe(a);
    expect(modifierUpdateKey({ effectId: 'm1', changes: {}, paramChanges: { speed: 1 } }))
      .not.toBe(modifierUpdateKey({ effectId: 'm1', changes: {}, paramChanges: { size: 1 } }));
  });

  it('fixture.drag: per fixture set, order-independent', () => {
    const ab = fixtureDragKey({ fixtures: [{ id: 'a' }, { id: 'b' }] });
    expect(fixtureDragKey({ fixtures: [{ id: 'b' }, { id: 'a' }] })).toBe(ab);
    expect(fixtureDragKey({ fixtures: [{ id: 'a' }] })).not.toBe(ab);
  });

  it('channel.update: per (fixture, channel) set', () => {
    const k = channelUpdateKey({ channels: [{ fixtureId: 'f', channelIndex: 0 }] });
    expect(channelUpdateKey({ channels: [{ fixtureId: 'f', channelIndex: 1 }] })).not.toBe(k);
    expect(channelUpdateKey({ channels: [{ fixtureId: 'g', channelIndex: 0 }] })).not.toBe(k);
  });

  it('color.override: per preset', () => {
    expect(colorOverrideKey({ key: 'p1' })).not.toBe(colorOverrideKey({ key: 'p2' }));
  });
});

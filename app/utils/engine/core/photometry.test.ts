import { describe, it, expect } from 'vitest';
import { Fixture } from './fixture';
import { Beam } from './beam';
import type { Channel } from './channel';
import { buildBeamPhotometry, resolvePhotometricColor, openValuesFor } from './photometry';
import { buildRenderRanges, computeOpenDefault } from '../../ofl/capability-map';
import type { OflWheel } from '../../ofl/types';

function makeChaser(value: number): Channel['chaserConfig'] {
  return {
    stepValues: [value],
    stepsCount: 1,
    activeEditStep: 0,
    isPlaying: false,
    stepDuration: { mode: 'beat', timeMs: 1000, beatValue: 1, beatOffset: 0 },
    fadeDuration: { mode: 'beat', timeMs: 0, beatValue: 0, beatOffset: 0 },
  };
}

function makeChannel(partial: Partial<Channel> & Pick<Channel, 'type' | 'role' | 'addressOffset'>): Channel {
  return {
    colorValue: '#FFFFFF',
    defaultValue: 0,
    chaserConfig: makeChaser(partial.defaultValue ?? 0),
    ...partial,
  };
}

describe('buildRenderRanges', () => {
  it('maps ShutterStrobe Open/Strobe/Closed capabilities to shutter ranges', () => {
    const ranges = buildRenderRanges([
      { type: 'ShutterStrobe', shutterEffect: 'Open', dmxRange: [0, 7] },
      { type: 'ShutterStrobe', shutterEffect: 'Strobe', dmxRange: [8, 215], speedStart: '1Hz', speedEnd: '20Hz' },
      { type: 'ShutterStrobe', shutterEffect: 'Closed', dmxRange: [216, 255] },
    ] as any);

    expect(ranges).toHaveLength(3);
    expect(ranges[0]).toMatchObject({ kind: 'shutter', min: 0, max: 7, freqStart: 0, freqEnd: 0 });
    expect(ranges[1]).toMatchObject({ kind: 'shutter', min: 8, max: 215, freqStart: 1, freqEnd: 20 });
    expect(ranges[2]).toMatchObject({ kind: 'shutter', min: 216, max: 255, freqStart: -1, freqEnd: -1 });
  });

  it('resolves WheelSlot capabilities to slot colors, defaulting to white when unknown', () => {
    const wheels: Record<string, OflWheel> = {
      'Color Wheel': {
        slots: [
          { type: 'Open' },
          { type: 'Color', colors: ['#FF0000'] },
          { type: 'Gobo' },
        ],
      } as OflWheel,
    };
    const ranges = buildRenderRanges(
      [
        { type: 'WheelSlot', wheel: 'Color Wheel', slotNumber: 1, dmxRange: [0, 84] },
        { type: 'WheelSlot', wheel: 'Color Wheel', slotNumber: 2, dmxRange: [85, 169] },
        { type: 'WheelSlot', wheel: 'Color Wheel', slotNumber: 3, dmxRange: [170, 255] },
      ] as any,
      wheels,
    );

    expect(ranges).toEqual([
      { kind: 'color', min: 0, max: 84, rgb: [255, 255, 255], rgbEnd: undefined },
      { kind: 'color', min: 85, max: 169, rgb: [255, 0, 0], rgbEnd: undefined },
      { kind: 'color', min: 170, max: 255, rgb: [255, 255, 255], rgbEnd: undefined },
    ]);
  });
});

describe('computeOpenDefault', () => {
  it('picks the middle of the Open shutter range', () => {
    const ranges = buildRenderRanges([
      { type: 'ShutterStrobe', shutterEffect: 'Open', dmxRange: [0, 9] },
      { type: 'ShutterStrobe', shutterEffect: 'Strobe', dmxRange: [10, 255] },
    ] as any);
    expect(computeOpenDefault('SHUTTER', ranges)).toBe(5);
  });

  it('picks the white slot for a color wheel', () => {
    const wheels: Record<string, OflWheel> = {
      Wheel: { slots: [{ type: 'Color', colors: ['#00FF00'] }, { type: 'Open' }] } as OflWheel,
    };
    const ranges = buildRenderRanges(
      [
        { type: 'WheelSlot', wheel: 'Wheel', slotNumber: 1, dmxRange: [0, 127] },
        { type: 'WheelSlot', wheel: 'Wheel', slotNumber: 2, dmxRange: [128, 255] },
      ] as any,
      wheels,
    );
    expect(computeOpenDefault('COLOR_WHEEL', ranges)).toBe(192); // mid of [128,255]
  });
});

describe('resolvePhotometricColor', () => {
  function fixtureWith(channels: Channel[]): Fixture {
    const f = new Fixture('f1', channels, 1);
    f.beams = [new Beam('beam-0', 0, 0)];
    return f;
  }

  it('mixes additive COLOR channels and applies the DIMMER multiplier', () => {
    const f = fixtureWith([
      makeChannel({ type: 'RED', role: 'COLOR', addressOffset: 0, colorValue: '#FF0000' }),
      makeChannel({ type: 'BLUE', role: 'COLOR', addressOffset: 1, colorValue: '#0000FF' }),
      makeChannel({ type: 'DIMMER', role: 'DIMMER', addressOffset: 2 }),
    ]);
    const dmx = new Uint8Array(512);
    dmx[0] = 255; dmx[1] = 255; dmx[2] = 128;

    const [r, g, b] = resolvePhotometricColor(buildBeamPhotometry(f), dmx);
    expect(r).toBe(128);
    expect(g).toBe(0);
    expect(b).toBe(128);
  });

  it('a color wheel channel selects a slot color WITHOUT scaling brightness (the moving-head bug)', () => {
    const f = fixtureWith([
      makeChannel({
        type: 'COLOR_WHEEL',
        role: 'COLOR_WHEEL',
        addressOffset: 0,
        renderInfo: { ranges: [{ kind: 'color', min: 0, max: 127, rgb: [255, 0, 0] }] },
      }),
      makeChannel({ type: 'DIMMER', role: 'DIMMER', addressOffset: 1 }),
    ]);
    const dmx = new Uint8Array(512);
    dmx[0] = 10; // low DMX value within the red slot's range
    dmx[1] = 255; // dimmer full

    const [r, g, b] = resolvePhotometricColor(buildBeamPhotometry(f), dmx);
    // Full red at full brightness — NOT scaled down by the low color-wheel DMX value.
    expect([r, g, b]).toEqual([255, 0, 0]);
  });

  it('a closed shutter gates the output to black regardless of dimmer/color', () => {
    const f = fixtureWith([
      makeChannel({ type: 'RED', role: 'COLOR', addressOffset: 0, colorValue: '#FF0000' }),
      makeChannel({ type: 'DIMMER', role: 'DIMMER', addressOffset: 1 }),
      makeChannel({
        type: 'STROBE',
        role: 'SHUTTER',
        addressOffset: 2,
        renderInfo: { ranges: [{ kind: 'shutter', min: 0, max: 255, freqStart: -1, freqEnd: -1 }] },
      }),
    ]);
    const dmx = new Uint8Array(512);
    dmx[0] = 255; dmx[1] = 255; dmx[2] = 0;

    expect(resolvePhotometricColor(buildBeamPhotometry(f), dmx)).toEqual([0, 0, 0]);
  });

  it('strobe blinks on/off over time and is treated as open when tSec is omitted', () => {
    const f = fixtureWith([
      makeChannel({ type: 'DIMMER', role: 'DIMMER', addressOffset: 0 }),
      makeChannel({
        type: 'STROBE',
        role: 'SHUTTER',
        addressOffset: 1,
        renderInfo: { ranges: [{ kind: 'shutter', min: 0, max: 255, freqStart: 1, freqEnd: 1 }] },
      }),
    ]);
    const dmx = new Uint8Array(512);
    dmx[0] = 255; dmx[1] = 128; // 1 Hz strobe

    expect(resolvePhotometricColor(buildBeamPhotometry(f), dmx, 0)).toEqual([255, 255, 255]);
    expect(resolvePhotometricColor(buildBeamPhotometry(f), dmx, 0.75)).toEqual([0, 0, 0]);
    expect(resolvePhotometricColor(buildBeamPhotometry(f), dmx)).toEqual([255, 255, 255]);
  });

  it('falls back to white when the fixture has no color source at all', () => {
    const f = fixtureWith([
      makeChannel({ type: 'DIMMER', role: 'DIMMER', addressOffset: 0 }),
    ]);
    const dmx = new Uint8Array(512);
    dmx[0] = 128;
    expect(resolvePhotometricColor(buildBeamPhotometry(f), dmx)).toEqual([128, 128, 128]);
  });
});

describe('openValuesFor', () => {
  it('sets dimmer to 255, opens the shutter, and selects the white wheel slot', () => {
    const f = new Fixture('f2', [
      makeChannel({ type: 'DIMMER', role: 'DIMMER', addressOffset: 0 }),
      makeChannel({
        type: 'STROBE',
        role: 'SHUTTER',
        addressOffset: 1,
        renderInfo: { ranges: [{ kind: 'shutter', min: 0, max: 9, freqStart: 0, freqEnd: 0 }] },
      }),
      makeChannel({
        type: 'COLOR_WHEEL',
        role: 'COLOR_WHEEL',
        addressOffset: 2,
        renderInfo: { ranges: [{ kind: 'color', min: 0, max: 127, rgb: [255, 0, 0] }, { kind: 'color', min: 128, max: 255, rgb: [255, 255, 255] }] },
      }),
    ], 1);

    const open = openValuesFor(f);
    const byType = Object.fromEntries(open.map(o => [o.channel.type, o.value]));
    expect(byType.DIMMER).toBe(255);
    expect(byType.STROBE).toBe(5);
    expect(byType.COLOR_WHEEL).toBe(192);
  });
});

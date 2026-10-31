import { describe, it, expect } from 'vitest';
import { Fixture } from './core/fixture';
import type { Channel } from './core/channel';
import { applyHighlight, buildHighlightSlots, HIGHLIGHT_HALF_PERIOD_MS } from './highlight-overlay';

/** Minimal channel with a static value. */
function channel(partial: Partial<Channel> & Pick<Channel, 'type' | 'role' | 'addressOffset'>): Channel {
  return {
    colorValue: '#FFFFFF',
    defaultValue: 0,
    chaserConfig: {
      stepValues: [0],
      stepsCount: 1,
      activeEditStep: 0,
      isPlaying: false,
      stepDuration: { mode: 'beat', timeMs: 1000, beatValue: 1, beatOffset: 0 },
      fadeDuration: { mode: 'beat', timeMs: 0, beatValue: 0, beatOffset: 0 },
    },
    ...partial,
  };
}

/** RGB-only fixture (like an X-Tube pixel) at `startAddress`. */
function rgbFixture(startAddress: number): Fixture {
  return new Fixture('rgb', [
    channel({ type: 'RED', role: 'COLOR', addressOffset: 0 }),
    channel({ type: 'GREEN', role: 'COLOR', addressOffset: 1 }),
    channel({ type: 'BLUE', role: 'COLOR', addressOffset: 2 }),
  ], startAddress);
}

describe('highlight overlay', () => {
  it('blinks RGB-only fixtures white over whatever the engine rendered', () => {
    const slots = buildHighlightSlots([rgbFixture(513)]);
    const buffer = new Uint8Array(1024).fill(42);

    applyHighlight(buffer, slots, 0);
    expect([...buffer.subarray(512, 515)]).toEqual([255, 255, 255]);

    applyHighlight(buffer, slots, HIGHLIGHT_HALF_PERIOD_MS);
    expect([...buffer.subarray(512, 515)]).toEqual([0, 0, 0]);
    // Channels outside the fixture stay untouched.
    expect(buffer[511]).toBe(42);
    expect(buffer[515]).toBe(42);
  });

  it('keeps the shutter open in the off phase', () => {
    const fixture = new Fixture('spot', [
      channel({ type: 'DIMMER', role: 'DIMMER', addressOffset: 0 }),
      channel({
        type: 'STROBE',
        role: 'SHUTTER',
        addressOffset: 1,
        // 0–9 open, rest strobe → open value is the middle of 0–9.
        renderInfo: { ranges: [
          { kind: 'shutter', min: 0, max: 9, freqStart: 0, freqEnd: 0 },
          { kind: 'shutter', min: 10, max: 255, freqStart: 1, freqEnd: 20 },
        ] },
      }),
    ], 1);
    const buffer = new Uint8Array(2);
    applyHighlight(buffer, buildHighlightSlots([fixture]), HIGHLIGHT_HALF_PERIOD_MS);
    expect(buffer[0]).toBe(0);
    expect(buffer[1]).toBe(5);
  });
});

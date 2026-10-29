/**
 * Pan/tilt motion range: OFL angle parsing, range derivation from
 * capabilities and the centered DMX → angle mapping.
 */
import { describe, expect, it } from 'vitest';
import { axisAngleDeg, motionRangeFromChannels, parseDeg } from './motion-range';
import type { Channel } from './channel';

/** Minimal channel stub — only the fields motion-range reads. */
const ch = (type: string, caps: object[]): Channel => ({ type, isFine: false, oflCapabilities: caps } as unknown as Channel);

describe('parseDeg', () => {
  it('accepts degree strings and numbers only', () => {
    expect(parseDeg('540deg')).toBe(540);
    expect(parseDeg('-270deg')).toBe(-270);
    expect(parseDeg(90)).toBe(90);
    expect(parseDeg('100%')).toBeNull();
    expect(parseDeg('left')).toBeNull();
  });
});

describe('motionRangeFromChannels', () => {
  it('reads angleStart/angleEnd of the positional capability', () => {
    const r = motionRangeFromChannels([
      ch('PAN', [{ type: 'Pan', dmxRange: [0, 255], angleStart: '0deg', angleEnd: '630deg' }]),
      ch('TILT', [{ type: 'Tilt', dmxRange: [0, 255], angleStart: '0deg', angleEnd: '230deg' }]),
    ]);
    expect(r).toEqual({ pan: [0, 630], tilt: [0, 230] });
  });

  it('spans split capabilities and keeps inverted direction', () => {
    const r = motionRangeFromChannels([
      ch('TILT', [
        { type: 'Tilt', dmxRange: [0, 127], angleStart: '135deg', angleEnd: '0deg' },
        { type: 'Tilt', dmxRange: [128, 255], angleStart: '0deg', angleEnd: '-135deg' },
      ]),
    ]);
    expect(r?.tilt).toEqual([135, -135]);
  });

  it('flags endless-rotation channels instead of treating them as positions', () => {
    const r = motionRangeFromChannels([ch('PAN', [{ type: 'PanContinuous', speedStart: 'slow CW', speedEnd: 'fast CW' }])]);
    expect(r).toEqual({ panContinuous: true });
  });

  it('ignores percentage angles (falls back to defaults later)', () => {
    expect(motionRangeFromChannels([ch('TILT', [{ type: 'Tilt', angleStart: '0%', angleEnd: '100%' }])])).toBeUndefined();
  });
});

describe('axisAngleDeg', () => {
  it('maps the DMX midpoint to the neutral pose', () => {
    expect(axisAngleDeg([0, 540], 0)).toBe(-270);
    expect(axisAngleDeg([0, 540], 0.5)).toBe(0);
    expect(axisAngleDeg([0, 540], 1)).toBe(270);
    expect(axisAngleDeg([135, -135], 0)).toBe(135);
  });
});

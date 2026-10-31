/** Speed fader: position ↔ multiplier in both modes. */
import { describe, expect, it } from 'vitest';
import { faderToSpeed, formatSpeed, speedToFader } from './speed-fader';

describe('continuous', () => {
  it('maps bottom / center / top to ½× / 1× / 2×', () => {
    expect(faderToSpeed(0, 'continuous')).toBeCloseTo(0.5);
    expect(faderToSpeed(0.5, 'continuous')).toBe(1);
    expect(faderToSpeed(1, 'continuous')).toBeCloseTo(2);
  });

  it('snaps near the center to exactly 1×', () => {
    expect(faderToSpeed(0.52, 'continuous')).toBe(1);
    expect(faderToSpeed(0.48, 'continuous')).toBe(1);
    expect(faderToSpeed(0.6, 'continuous')).toBeGreaterThan(1);
  });

  it('round-trips outside the dead zone', () => {
    for (const v of [0, 0.2, 0.4, 0.7, 1]) {
      expect(speedToFader(faderToSpeed(v, 'continuous'), 'continuous')).toBeCloseTo(v);
    }
    expect(speedToFader(1, 'continuous')).toBe(0.5);
  });
});

describe('steps', () => {
  it('snaps to ¼× … 4× with 1× in the middle', () => {
    expect(faderToSpeed(0, 'steps')).toBe(0.25);
    expect(faderToSpeed(0.3, 'steps')).toBe(0.5);
    expect(faderToSpeed(0.5, 'steps')).toBe(1);
    expect(faderToSpeed(0.8, 'steps')).toBe(2);
    expect(faderToSpeed(1, 'steps')).toBe(4);
  });

  it('draws the knob at the nearest step', () => {
    expect(speedToFader(0.5, 'steps')).toBe(0.25);
    expect(speedToFader(1, 'steps')).toBe(0.5);
    expect(speedToFader(2.5, 'steps')).toBe(0.75);
    expect(speedToFader(0, 'steps')).toBe(0);
  });
});

it('formats multipliers', () => {
  expect(formatSpeed(0.25)).toBe('¼×');
  expect(formatSpeed(0.5)).toBe('½×');
  expect(formatSpeed(2)).toBe('2×');
  expect(formatSpeed(1.4142)).toBe('1.41×');
  expect(formatSpeed(0)).toBe('Freeze');
});

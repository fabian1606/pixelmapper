import { describe, expect, it } from 'vitest';
import { buildColorShift, shiftSample } from './preset-apply';

// ── Color override shift (live color variants) ────────────────────────────────

describe('buildColorShift / shiftSample', () => {
  const RED = { r: 255, g: 0, b: 0 };
  const WHITE = { r: 255, g: 255, b: 255 };

  it('rotates hue for chromatic overrides', () => {
    const shift = buildColorShift(RED, { r: 0, g: 0, b: 255 });
    expect(shiftSample({ r: 0, g: 255, b: 0 }, shift)).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('desaturates every chromatic step to white for a white override, keeping value', () => {
    const shift = buildColorShift(RED, WHITE);
    expect(shiftSample({ r: 0, g: 0, b: 255 }, shift)).toEqual(WHITE);
    expect(shiftSample({ r: 0, g: 128, b: 0 }, shift)).toEqual({ r: 128, g: 128, b: 128 });
  });

  it('leaves achromatic steps untouched when the reference is chromatic', () => {
    const shift = buildColorShift(RED, { r: 0, g: 255, b: 0 });
    expect(shiftSample(WHITE, shift)).toEqual(WHITE);
  });

  it('tints achromatic steps when the reference itself is white', () => {
    const shift = buildColorShift(WHITE, RED);
    expect(shiftSample(WHITE, shift)).toEqual(RED);
    expect(shiftSample({ r: 0, g: 0, b: 0 }, shift)).toEqual({ r: 0, g: 0, b: 0 });
  });
});

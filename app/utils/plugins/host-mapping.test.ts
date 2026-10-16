// @vitest-environment node
/**
 * Host output mapping (ADR A13/A20, plan M0.2): the preview mirror of
 * rs-engine `engine::blend` (same cases as `scale_output_is_a_fraction_of_the_programmed_value`).
 */
import { describe, expect, it } from 'vitest';
import { mapOutput } from './host-mapping';

describe('mapOutput', () => {
  it('scale: the level is a fraction of the programmed value', () => {
    expect(mapOutput('scale', 1, 0.2, 1)).toBeCloseTo(0.2);
    expect(mapOutput('scale', 0.6, 0.2, 1)).toBeCloseTo(0.12);
    expect(mapOutput('scale', 0.3, 0.2, 1)).toBeCloseTo(0.06);
    expect(mapOutput('scale', 0.3, 1, 1)).toBeCloseTo(0.3);
    expect(mapOutput('scale', 0.3, 0, 0.5)).toBeCloseTo(0.15);
  });

  it('scale equals bipolar at base 100 %', () => {
    for (const v of [0, 0.25, 0.7, 1]) {
      expect(mapOutput('scale', 1, v, 0.6)).toBeCloseTo(mapOutput('bipolar', 1, 2 * v - 1, 0.6));
    }
  });

  it('keeps bipolar and absolute unchanged', () => {
    expect(mapOutput('bipolar', 0.8, -1, 0.4)).toBeCloseTo(0.4);
    expect(mapOutput('absolute', 0.2, 0.6, 0.5)).toBeCloseTo(0.4);
    expect(mapOutput('absolute', 0.5, Number.NaN, 1)).toBe(0.5);
  });
});

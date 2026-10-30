// @vitest-environment node
/**
 * Param values produced by live controls for `effect-param` mappings:
 * sliders (range / bool threshold), buttons (bool toggle / momentary) and
 * xy pads (point).
 */
import { describe, expect, it } from 'vitest';
import { CONTROL_PARAM_TYPES, controlParamValue, paramTypeOfValue } from './control-param-value';

const NUMBER = { type: 'number', min: 10, max: 20 };
const INT = { type: 'int', min: 0, max: 4 };
const BOOL = { type: 'bool' };
const POINT = { type: 'point' };

describe('controlParamValue', () => {
  it('maps slider values onto number/int ranges and the bool threshold', () => {
    expect(controlParamValue(NUMBER, 12, { active: true, value: 0.5 })).toBe(15);
    expect(controlParamValue(INT, 0, { active: true, value: 0.6 })).toBe(2);
    expect(controlParamValue(BOOL, false, { active: true, value: 0.5 })).toBe(true);
    expect(controlParamValue(BOOL, true, { active: true, value: 0.2 })).toBe(false);
  });

  it('toggles bool params on button press by default (latch) and ignores the release', () => {
    expect(controlParamValue(BOOL, false, { active: true })).toBe(true);
    expect(controlParamValue(BOOL, true, { active: true, behavior: 'latch' })).toBe(false);
    expect(controlParamValue(BOOL, true, { active: false })).toBeUndefined();
  });

  it('holds bool params while a momentary button is pressed', () => {
    expect(controlParamValue(BOOL, false, { active: true, behavior: 'hold' })).toBe(true);
    expect(controlParamValue(BOOL, true, { active: false, behavior: 'hold' })).toBe(false);
  });

  it('maps both xy axes onto a point param, clamped to 0–1', () => {
    expect(controlParamValue(POINT, { x: 0.5, y: 0.5 }, { active: true, value: 0.25, value2: 1.2 })).toEqual({ x: 0.25, y: 1 });
    // A slider (one axis) or a button cannot drive a point.
    expect(controlParamValue(POINT, { x: 0.5, y: 0.5 }, { active: true, value: 0.25 })).toBeUndefined();
    expect(controlParamValue(POINT, { x: 0.5, y: 0.5 }, { active: true })).toBeUndefined();
  });

  it('ignores inputs a param type cannot take', () => {
    expect(controlParamValue(NUMBER, 12, { active: true })).toBeUndefined();
    expect(controlParamValue({ type: 'color' }, null, { active: true, value: 1 })).toBeUndefined();
    expect(controlParamValue(undefined, 1, { active: true, value: 1 })).toBeUndefined();
  });
});

describe('capabilities', () => {
  it('lists the param types per control kind', () => {
    expect(CONTROL_PARAM_TYPES.xy).toEqual(['point']);
    expect(CONTROL_PARAM_TYPES.button).toEqual(['bool', 'trigger']);
  });

  it('infers param types from stored values', () => {
    expect(paramTypeOfValue(3)).toBe('number');
    expect(paramTypeOfValue(false)).toBe('bool');
    expect(paramTypeOfValue({ x: 0, y: 1 })).toBe('point');
    expect(paramTypeOfValue('wave')).toBeNull();
  });
});

// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { PRETTY_JSON_MAX_CHARS, jsonText } from './shared';

describe('jsonText', () => {
  it('indents small values', () => {
    expect(jsonText({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('serializes large values without indentation', () => {
    const value = { pixels: Array.from({ length: 1_000 }, (_, i) => ({ index: i, x: i / 1_000 })) };
    expect(JSON.stringify(value, null, 2).length).toBeGreaterThan(PRETTY_JSON_MAX_CHARS);
    expect(jsonText(value)).toBe(JSON.stringify(value));
  });

  it('renders undefined as null', () => {
    expect(jsonText(undefined)).toBe('null');
  });
});

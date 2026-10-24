/**
 * Tests for the RDM ID text helpers of the custom fixture editor (M4.7).
 */
import { describe, expect, it } from 'vitest';
import { formatRdmId, parseRdmId, parseRdmPersonalityIndex } from './rdm-id';

describe('parseRdmId', () => {
  it('accepts decimal and hex (any case)', () => {
    expect(parseRdmId('32752')).toBe(0x7ff0);
    expect(parseRdmId('0x7FF0')).toBe(0x7ff0);
    expect(parseRdmId(' 0x7ff0 ')).toBe(0x7ff0);
    expect(parseRdmId('0X1')).toBe(1);
    expect(parseRdmId('0')).toBe(0);
  });

  it('returns null for empty input (field cleared)', () => {
    expect(parseRdmId('')).toBeNull();
    expect(parseRdmId('   ')).toBeNull();
  });

  it('returns undefined for invalid or out-of-range input', () => {
    expect(parseRdmId('0x1FFFF')).toBeUndefined();
    expect(parseRdmId('65536')).toBeUndefined();
    expect(parseRdmId('7FF0')).toBeUndefined();
    expect(parseRdmId('-1')).toBeUndefined();
    expect(parseRdmId('0x')).toBeUndefined();
  });
});

describe('formatRdmId', () => {
  it('formats as 4-digit uppercase hex', () => {
    expect(formatRdmId(0x7ff0)).toBe('0x7FF0');
    expect(formatRdmId(1)).toBe('0x0001');
  });

  it('returns an empty string when unset', () => {
    expect(formatRdmId(null)).toBe('');
    expect(formatRdmId(undefined)).toBe('');
  });
});

describe('parseRdmPersonalityIndex', () => {
  it('accepts positive integers, null for empty, undefined otherwise', () => {
    expect(parseRdmPersonalityIndex('3')).toBe(3);
    expect(parseRdmPersonalityIndex('')).toBeNull();
    expect(parseRdmPersonalityIndex('0')).toBeUndefined();
    expect(parseRdmPersonalityIndex('1.5')).toBeUndefined();
    expect(parseRdmPersonalityIndex('abc')).toBeUndefined();
  });
});

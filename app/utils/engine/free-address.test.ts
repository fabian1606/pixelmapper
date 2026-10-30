// @vitest-environment node
/**
 * Free address search (plan M4.2): the dialog's original algorithm, plus
 * `ignore` and the per-universe variant used by the extension API.
 */
import { describe, expect, it } from 'vitest';
import { findFreeAddressSpan, type AddressOccupant } from './free-address';

/** Shorthand for an occupant. */
const at = (id: string, startAddress: number, channelCount: number): AddressOccupant => ({ id, startAddress, channelCount });

describe('findFreeAddressSpan', () => {
  it('returns 1 for an empty patch', () => {
    expect(findFreeAddressSpan([], 12, 3)).toBe(1);
  });

  it('finds the first gap large enough for footprint × count (unsorted input)', () => {
    const fixtures = [at('c', 40, 10), at('a', 1, 10), at('b', 20, 10)];
    expect(findFreeAddressSpan(fixtures, 9, 1)).toBe(11); // 11..19 fits exactly
    expect(findFreeAddressSpan(fixtures, 10, 1)).toBe(30); // 11..20 would overlap b
    expect(findFreeAddressSpan(fixtures, 5, 2)).toBe(30);
    expect(findFreeAddressSpan(fixtures, 11, 1)).toBe(50);
  });

  it('may cross universe boundaries without the universe option (dialog behavior)', () => {
    expect(findFreeAddressSpan([at('a', 1, 510)], 12, 1)).toBe(511);
  });

  it('ignores the given fixtures', () => {
    const fixtures = [at('a', 1, 10), at('b', 11, 10)];
    expect(findFreeAddressSpan(fixtures, 10, 1, { ignore: ['a'] })).toBe(1);
  });

  it('keeps the span inside one universe and returns null when it does not fit', () => {
    const fixtures = [at('a', 1, 500), at('b', 513, 12)];
    expect(findFreeAddressSpan(fixtures, 12, 1, { universe: 1 })).toBe(501);
    expect(findFreeAddressSpan(fixtures, 13, 1, { universe: 1 })).toBeNull();
    expect(findFreeAddressSpan(fixtures, 12, 1, { universe: 2 })).toBe(525);
    // An occupant reaching into the universe from the previous one counts.
    expect(findFreeAddressSpan([at('x', 505, 20)], 4, 1, { universe: 2 })).toBe(525);
  });
});

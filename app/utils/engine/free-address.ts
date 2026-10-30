/**
 * Free DMX address search (plan M4.2).
 *
 * Shared by the add-fixture dialog (address suggestion) and the extension
 * API (`findFreeAddressSpan`, e.g. "Assign free address" of a connector).
 */

/** Anything occupying DMX channels. */
export interface AddressOccupant {
  /** Fixture id (used by `ignore`). */
  id?: string | number;
  /** 1-based absolute start address. */
  startAddress: number;
  /** Number of channels from `startAddress`. */
  channelCount: number;
}

/** Options of `findFreeAddressSpan`. */
export interface FindFreeAddressOptions {
  /** Occupants to ignore, e.g. the fixtures being re-addressed. */
  ignore?: Iterable<string | number>;
  /**
   * 1-based universe the whole span must lie in. Without it the search runs
   * over the absolute address space and may cross universe boundaries (the
   * add dialog then wraps fixtures that do not fit into the next universe).
   */
  universe?: number;
}

/** Size of one DMX universe. */
const UNIVERSE_SIZE = 512;

/**
 * First absolute start address (1-based) of a gap of `footprint * count`
 * channels that no occupant uses. Returns `null` only when `universe` is
 * given and the span does not fit into it.
 */
export function findFreeAddressSpan(
  fixtures: readonly AddressOccupant[],
  footprint: number,
  count: number,
  options: FindFreeAddressOptions = {},
): number | null {
  const requiredSpan = footprint * count;
  const ignored = new Set(options.ignore ?? []);
  const lower = options.universe !== undefined ? (options.universe - 1) * UNIVERSE_SIZE + 1 : 1;
  const upper = options.universe !== undefined ? options.universe * UNIVERSE_SIZE : Number.POSITIVE_INFINITY;

  const occupiedRanges = fixtures
    .filter(f => f.id === undefined || !ignored.has(f.id))
    .map(f => ({ start: f.startAddress, end: f.startAddress + f.channelCount - 1 }))
    .filter(r => r.end >= lower && r.start <= upper)
    .sort((a, b) => a.start - b.start);

  // Walk the sorted ranges; stop at the first gap that is large enough.
  let searchStart = lower;
  for (const range of occupiedRanges) {
    if (searchStart + requiredSpan - 1 < range.start) break;
    searchStart = Math.max(searchStart, range.end + 1);
  }
  if (searchStart + requiredSpan - 1 > upper) return null;
  return searchStart;
}

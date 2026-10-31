import type { Fixture } from '~/utils/engine/core/fixture';
import { openValuesFor } from '~/utils/engine/core/photometry';

// ── Highlight overlay ─────────────────────────────────────────────────────────
//
// "Highlight" identifies fixtures on the rig: they blink full white until the
// highlight is stopped. It is written onto the final output buffer (after the
// engine and the Simple Desk overrides), so running effects can't mask it —
// RGB-only fixtures (pixel bars, X-Tubes) have no dimmer that could carry a
// base-value highlight through an effect that drives their color.

/** Blink half period: 250 ms on, 250 ms off (2 Hz). */
export const HIGHLIGHT_HALF_PERIOD_MS = 250;

/** One buffer slot the highlight writes, with its value in the on and off phase. */
export interface HighlightSlot {
  /** 0-based index into the global output buffer. */
  index: number;
  on: number;
  off: number;
}

/**
 * Buffer slots that make `fixtures` emit white (on) or nothing (off).
 * Shutter and color wheel stay at their open/white value in the off phase so
 * the blink comes from intensity alone, not from wheel or shutter motion.
 */
export function buildHighlightSlots(fixtures: Fixture[]): HighlightSlot[] {
  const slots: HighlightSlot[] = [];
  for (const fixture of fixtures) {
    const base = fixture.startAddress - 1;
    for (const { channel, value } of openValuesFor(fixture)) {
      const keepsOpen = channel.role === 'SHUTTER' || channel.role === 'COLOR_WHEEL';
      slots.push({ index: base + channel.addressOffset, on: value, off: keepsOpen ? value : 0 });
    }
  }
  return slots;
}

/** True during the lit half of the blink cycle at `nowMs`. */
export function highlightPhaseOn(nowMs: number): boolean {
  return Math.floor(nowMs / HIGHLIGHT_HALF_PERIOD_MS) % 2 === 0;
}

/** Writes the highlight's current blink phase into `buffer` (in place). */
export function applyHighlight(buffer: Uint8Array, slots: HighlightSlot[], nowMs: number): void {
  const on = highlightPhaseOn(nowMs);
  for (const slot of slots) {
    if (slot.index < buffer.length) buffer[slot.index] = on ? slot.on : slot.off;
  }
}

/**
 * Host mapping of a plugin output onto the value under the modifier
 * (mirror of rs-engine/core `engine::blend` for previews, ADR A13/A20).
 * Previews show a single modifier, so `prev = base` and only the mapping
 * (not the blend mode) matters.
 */
import type { ModifierOutputMode } from '@pixelmapper/plugin-toolchain/types';

/**
 * Maps a raw plugin output to the displayed value, clamped to [0, 1]:
 * - `bipolar`: `base + strength × (raw − 1) / 2`
 * - `absolute`: `base + (raw − base) × strength`
 * - `scale`: `base × (1 − strength + strength × raw)`
 */
export function mapOutput(output: ModifierOutputMode, base: number, raw: number, strength: number): number {
  let v: number;
  switch (output) {
    case 'bipolar': v = base + (strength * (raw - 1)) / 2; break;
    case 'scale': v = base * (1 - strength + strength * Math.max(0, Math.min(1, raw))); break;
    default: v = base + (raw - base) * strength;
  }
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : base;
}

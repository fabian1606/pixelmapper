/**
 * Patch state of fixtures (plan M4.5/M4.6): start address, universe, local
 * address, channel count and mode — the part of a fixture that guards see
 * and observers are notified about.
 */
import type { FixturePatchState } from '@pixelmapper/extension-api';
import type { Fixture } from '~/utils/engine/core/fixture';

/** Size of one DMX universe. */
const UNIVERSE_SIZE = 512;

/** Patch state for an absolute start address and channel count. */
export function patchStateAt(startAddress: number, channelCount: number, modeIndex?: number): FixturePatchState {
  return {
    startAddress,
    universe: Math.floor((startAddress - 1) / UNIVERSE_SIZE) + 1,
    localAddress: ((startAddress - 1) % UNIVERSE_SIZE) + 1,
    channelCount,
    modeIndex,
  };
}

/** Current patch state of a fixture. */
export function patchStateOf(fixture: Fixture): FixturePatchState {
  return patchStateAt(fixture.startAddress, fixture.channels.length, fixture.source?.modeIndex);
}

/** True when two patch states differ in anything observable. */
export function patchStatesDiffer(a: FixturePatchState, b: FixturePatchState): boolean {
  return a.startAddress !== b.startAddress || a.channelCount !== b.channelCount || a.modeIndex !== b.modeIndex;
}

import type { MergeConflict } from '../types';
import { registerRebaseAdapter, passThroughAdapter, type RebaseAdapter } from './registry';
import { checkOverwrite, ok } from './helpers';

/**
 * Rebase adapters for global engine live-ops (`engine.*`). They set scalars,
 * so they always apply; `engine.bpm` additionally reports a concurrent remote
 * BPM change when the previous state is known.
 */

// ── Adapters ─────────────────────────────────────────────────────────────────

/** `engine.bpm`: last write is local; conflict if the remote BPM changed too. */
export const engineBpmAdapter: RebaseAdapter = (payload: { bpm: number }, { current, previous }) => {
  const conflicts: MergeConflict[] = [];
  if (previous) checkOverwrite(previous.globalBpm, payload.bpm, current.globalBpm, null, ['globalBpm'], conflicts);
  return ok(payload, conflicts);
};

// ── Registration ─────────────────────────────────────────────────────────────

/** Register all engine live-op adapters. */
export function registerEngineAdapters(): void {
  registerRebaseAdapter('engine.bpm', engineBpmAdapter);
  // Runtime-only multiplier → replay as recorded.
  registerRebaseAdapter('engine.speed', passThroughAdapter);
  // Runtime-only master dimmer level → replay as recorded.
  registerRebaseAdapter('engine.master', passThroughAdapter);
  // Min-merged epoch (apply keeps the smaller value) → commutative, pass through.
  registerRebaseAdapter('engine.clock', passThroughAdapter);
  // Tap nudge at a wall-clock moment → replay as recorded.
  registerRebaseAdapter('engine.beatAlign', passThroughAdapter);
}

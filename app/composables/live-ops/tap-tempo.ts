import { useEngineStore } from '~/stores/engine-store';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { recordLiveStep } from './live-history';

/**
 * Tap tempo shared by the Beat widget and the "Beat" global function on
 * buttons / pads: same rules as `pm.tapTempo` (taps reset after 2.5 s, the last
 * 8 taps are averaged, 20–300 BPM). The clock epoch stays put, so running
 * presets keep going instead of restarting. Instead, every tap nudges the
 * beat grid onto itself: the engine's beat clock runs slightly faster/slower
 * for a few beats until the tap sits on a whole beat (no phase jump).
 *
 * Module singleton: one tap series per tab.
 */

/** Gap after which a new tap starts a new series. */
const TAP_RESET_MS = 2500;
/** Taps averaged into the tempo. */
const TAP_WINDOW = 8;

const tapTimes: number[] = [];
let resetTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Sets the base BPM (clamped to 20–300) and broadcasts it. Never touches the
 * clock epoch — re-anchoring it would jump every running preset back to t=0.
 */
export function applyTapBpm(newBpm: number): void {
  const engineStore = useEngineStore();
  if (!engineStore.engine) return;
  const clamped = Math.max(20, Math.min(300, Math.round(newBpm)));
  const liveBus = useLiveBusStore();
  // A tap series is one step: Step back returns to the tempo before it.
  recordLiveStep({ coalesce: 'bpm' });
  engineStore.baseBpm = clamped;
  liveBus.dispatch('engine.bpm', { bpm: clamped });
}

/**
 * Slides the beat grid onto a tap at `tapMs` (wall clock) here and on all
 * collaborators (`engine.beatAlign`; each engine nudges its own clock).
 */
export function alignBeatToTap(tapMs = Date.now()): void {
  const engineStore = useEngineStore();
  if (!engineStore.engine) return;
  engineStore.alignBeat(tapMs);
  useLiveBusStore().dispatch('engine.beatAlign', { tapMs });
}

/** Records one tap (aligns the beat); from the second tap of a series on, sets the averaged tempo. */
export function tapBeat(now = Date.now()): void {
  if (resetTimer) clearTimeout(resetTimer);
  resetTimer = setTimeout(() => { tapTimes.length = 0; }, TAP_RESET_MS);
  tapTimes.push(now);
  if (tapTimes.length > TAP_WINDOW) tapTimes.shift();
  alignBeatToTap(now);
  if (tapTimes.length < 2) return;
  const avg = (tapTimes[tapTimes.length - 1]! - tapTimes[0]!) / (tapTimes.length - 1);
  if (avg > 0) applyTapBpm(60000 / avg);
}

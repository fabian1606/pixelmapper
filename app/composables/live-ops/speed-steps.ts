import { useEngineStore } from '~/stores/engine-store';
import { useLiveBusStore } from '~/stores/live-bus-store';
import { SPEED_STEPS } from '~/utils/live/speed-fader';
import { recordLiveStep } from './live-history';

/**
 * Relative speed buttons ("×2", "÷2") and the speed reset. They change the
 * global speed multiplier on top of the tapped BPM, so tap tempo keeps
 * working; the range is the one of the stepped speed fader (¼× … 4×).
 */

/** Slowest / fastest multiplier the ×2 / ÷2 buttons reach. */
const MIN_SPEED = SPEED_STEPS[0]!;
const MAX_SPEED = SPEED_STEPS[SPEED_STEPS.length - 1]!;

/** Sets the multiplier and broadcasts it (no-op when unchanged). */
export function setSpeed(multiplier: number): void {
  const engineStore = useEngineStore();
  if (engineStore.speedMultiplier === multiplier) return;
  engineStore.setSpeedMultiplier(multiplier);
  queueMicrotask(() => useLiveBusStore().dispatch('engine.speed', { multiplier }));
}

/**
 * Multiplies the current speed by `factor`, clamped to ¼×–4×. Freeze (0×)
 * counts as 1×. Quick presses in a row are one Step back step.
 */
export function stepSpeed(factor: number): void {
  const current = useEngineStore().speedMultiplier || 1;
  const next = Math.max(MIN_SPEED, Math.min(MAX_SPEED, current * factor));
  if (next === useEngineStore().speedMultiplier) return;
  recordLiveStep({ coalesce: 'speed' });
  setSpeed(next);
}

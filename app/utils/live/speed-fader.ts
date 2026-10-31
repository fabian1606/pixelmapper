import type { SpeedFaderMode } from '~/utils/live/types';

/**
 * Speed fader math: a 0–1 fader position ↔ the global speed multiplier
 * (effective BPM = tapped base BPM × multiplier, so tapping keeps working).
 *
 * - `continuous`: center = 1×, bottom = ½×, top = 2×, exponential so equal
 *   fader travel is an equal tempo ratio. A small dead zone around the
 *   center snaps to exactly 1× (a physical fader never hits the middle).
 * - `steps`: the fader snaps to fixed multipliers (¼× … 4×, 1× in the middle).
 */

/** Multipliers of the `steps` mode, bottom to top. */
export const SPEED_STEPS = [0.25, 0.5, 1, 2, 4];

/** Half-width of the 1× dead zone in continuous mode (fraction of the half range). */
const DEAD_ZONE = 0.06;

/** Fader position 0–1 → speed multiplier. */
export function faderToSpeed(v: number, mode: SpeedFaderMode): number {
  const t = Math.max(0, Math.min(1, v));
  if (mode === 'steps') return SPEED_STEPS[Math.round(t * (SPEED_STEPS.length - 1))]!;
  // -1..1 around the center, dead zone removed and the rest stretched back to ±1.
  const d = 2 * t - 1;
  const mag = Math.max(0, Math.abs(d) - DEAD_ZONE) / (1 - DEAD_ZONE);
  return 2 ** (Math.sign(d) * mag);
}

/** Speed multiplier → fader position 0–1 (where the on-screen knob is drawn). */
export function speedToFader(m: number, mode: SpeedFaderMode): number {
  if (mode === 'steps') {
    // Nearest step on a log scale (½× sits between ¼× and 1×).
    const dist = (s: number) => Math.abs(Math.log2(s / Math.max(m, 1e-3)));
    let best = 0;
    for (let i = 1; i < SPEED_STEPS.length; i++) {
      if (dist(SPEED_STEPS[i]!) < dist(SPEED_STEPS[best]!)) best = i;
    }
    return best / (SPEED_STEPS.length - 1);
  }
  const d = Math.max(-1, Math.min(1, Math.log2(Math.max(m, 1e-3))));
  if (d === 0) return 0.5;
  const mag = Math.abs(d) * (1 - DEAD_ZONE) + DEAD_ZONE;
  return (1 + Math.sign(d) * mag) / 2;
}

const FRACTIONS: Record<number, string> = { 0.25: '¼', 0.5: '½' };

/** Short readout: "¼×", "½×", "1×", "2×", "1.35×", "Freeze". */
export function formatSpeed(m: number): string {
  if (m === 0) return 'Freeze';
  if (FRACTIONS[m]) return `${FRACTIONS[m]}×`;
  return `${Number.isInteger(m) ? m : m.toFixed(2)}×`;
}

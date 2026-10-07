/**
 * Periodic wave shapes over a normalized cycle position t ∈ [0, 1), output
 * roughly [-1, 1]. Exact port of the former engine's `evaluate_shape`; used
 * by the built-in waveform and color-adjust plugins.
 */
import { PI, TAU, roundAway } from "./math";

/** Shape ids (enum param index order of the built-ins). */
export const WAVE_SINE: i32 = 0;
export const WAVE_SQUARE: i32 = 1;
export const WAVE_TRIANGLE: i32 = 2;
export const WAVE_SAWTOOTH: i32 = 3;
export const WAVE_BOUNCE: i32 = 4;
export const WAVE_RAMP: i32 = 5;
export const WAVE_SMOOTH: i32 = 6;

/**
 * Evaluates `shape` at `t` ∈ [0, 1). `param` (0–1) adjusts the shape: square
 * duty cycle, triangle/smooth peak position, sawtooth direction (< 0.5
 * falling), bounce count (1–5), ramp softness.
 */
export function evaluateShape(shape: i32, t: f32, param: f32): f32 {
  switch (shape) {
    case WAVE_SQUARE: {
      const duty: f32 = 0.05 + param * 0.9;
      return t < duty ? 1.0 : -1.0;
    }
    case WAVE_TRIANGLE: {
      const peak: f32 = 0.05 + param * 0.9;
      return t < peak ? 2.0 * t / peak - 1.0 : 1.0 - 2.0 * (t - peak) / (1.0 - peak);
    }
    case WAVE_SAWTOOTH:
      return param < 0.5 ? 1.0 - 2.0 * t : 2.0 * t - 1.0;
    case WAVE_BOUNCE: {
      const count = roundAway(1.0 + param * 4.0);
      return Mathf.abs(Mathf.sin(count * PI * t));
    }
    case WAVE_RAMP: {
      const softness: f32 = 0.1 + param * 9.9;
      const denom = Mathf.tanh(softness * 3.0);
      if (Mathf.abs(denom) < 1e-6) return t < 0.5 ? -1.0 : 1.0;
      return Mathf.tanh(softness * (t - 0.5) * 6.0) / denom;
    }
    case WAVE_SMOOTH: {
      const peak: f32 = 0.05 + param * 0.9;
      return t <= peak ? -Mathf.cos(PI * t / peak) : Mathf.cos(PI * (t - peak) / (1.0 - peak));
    }
    default:
      return Mathf.sin(t * TAU);
  }
}

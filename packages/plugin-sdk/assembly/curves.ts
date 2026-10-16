/**
 * Curve params arrive as host-sampled LUTs (128 values in [0, 1], ADR §6.2).
 */

/** Number of values in a curve LUT. */
export const CURVE_LUT_SIZE: i32 = 128;

/** Samples a LUT at `x` ∈ [0, 1] with linear interpolation. */
export function sampleLut(lut: usize, x: f32, size: i32 = CURVE_LUT_SIZE): f32 {
  if (size <= 0) return 0.0;
  if (size == 1) return load<f32>(lut);
  const cx = x < 0.0 ? <f32>0.0 : x > 1.0 ? <f32>1.0 : x;
  const pos = cx * <f32>(size - 1);
  const i = <i32>Mathf.floor(pos);
  if (i >= size - 1) return load<f32>(lut + (<usize>(size - 1) << 2));
  const t = pos - <f32>i;
  const a = load<f32>(lut + (<usize>i << 2));
  const b = load<f32>(lut + (<usize>(i + 1) << 2));
  return a + (b - a) * t;
}

/** Wraps `x` into [−1, 1) (period 2; signed-domain profiles repeat with it). */
export function wrapSigned(x: f32): f32 {
  const y = (x + 1.0) * 0.5;
  return (y - Mathf.floor(y)) * 2.0 - 1.0;
}

/**
 * Samples a `signed`-domain LUT (curve `domain: "signed"`, x ∈ [−1, 1]) at
 * `x`; values outside [−1, 1] wrap (periodic profiles).
 */
export function sampleSignedLut(lut: usize, x: f32, size: i32 = CURVE_LUT_SIZE): f32 {
  const w = x < -1.0 || x > 1.0 ? wrapSigned(x) : x;
  return sampleLut(lut, (w + 1.0) * 0.5, size);
}

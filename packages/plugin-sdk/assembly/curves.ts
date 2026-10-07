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

/**
 * Gradient params (plan §1.5): 33 slots `count, (pos, r, g, b) × 8`, stops
 * sorted by position. Address a gradient with `params.lut(slot)`. The palette
 * is periodic in u ∈ [0, 1): stop i holds from its position to the next stop
 * (the last wraps to the first).
 *
 * This module has no imports and no module-level state on purpose: adding
 * SDK code must not change the binaries (and hashes) of plugins that do not
 * use it.
 */

/** Number of stops (1–8) of the gradient at address `g`. */
export function gradientCount(g: usize): i32 {
  const n = <i32>load<f32>(g);
  return n < 1 ? 1 : n > 8 ? 8 : n;
}

/** Position of stop `i`. */
@inline export function gradientPos(g: usize, i: i32): f32 {
  return load<f32>(g + (<usize>(1 + i * 4) << 2));
}

/** Channel `c` (0 = r, 1 = g, 2 = b) of stop `i`. */
@inline export function gradientStopChannel(g: usize, i: i32, c: i32): f32 {
  return load<f32>(g + (<usize>(2 + i * 4 + c) << 2));
}

/**
 * Channel `c` of the periodic palette at `u` (wrapped to [0, 1)).
 * `transition` 0 = hard (each stop holds until the next), 1 = smooth blend
 * across the whole segment; in between the blend uses the last `transition`
 * part of each segment.
 */
export function sampleGradient(g: usize, u: f32, transition: f32, c: i32): f32 {
  const n = gradientCount(g);
  if (n == 1) return gradientStopChannel(g, 0, c);
  const x = u - Mathf.floor(u);
  let k = n - 1;
  for (let i = 0; i < n; i++) {
    if (x < gradientPos(g, i)) { k = i - 1; break; }
  }
  const ki = k < 0 ? n - 1 : k;
  const kj = (ki + 1) % n;
  const startPos = k < 0 ? gradientPos(g, n - 1) - 1.0 : gradientPos(g, ki);
  const endPos = kj == 0 ? gradientPos(g, 0) + 1.0 : gradientPos(g, kj);
  const f = (x - startPos) / Mathf.max(endPos - startPos, 1e-6);
  const w = Mathf.max(transition, 0.0);
  let t: f32 = 0.0;
  if (w > 0.0 && f > 1.0 - w) {
    const s = (f - (1.0 - w)) / w;
    t = s * s * (3.0 - 2.0 * s);
  }
  const a = gradientStopChannel(g, ki, c);
  return a + (gradientStopChannel(g, kj, c) - a) * t;
}

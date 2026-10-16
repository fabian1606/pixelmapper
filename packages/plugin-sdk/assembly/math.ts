/**
 * Deterministic math helpers for modifiers. No `Math.random`, no time: all
 * randomness derives from host-provided seeds so every client renders the
 * same output (ADR D5).
 *
 * `seededRandom`, `perlin2`, `fnv1aPos` and `crossfade` are exact ports of the
 * former Rust effects (`rs-engine/core/src/effects.rs`) so built-ins keep
 * their look.
 */

/** 2π as f32. */
export const TAU: f32 = 6.2831855;
/** π as f32. */
export const PI: f32 = 3.1415927;

/** Clamps `v` into [lo, hi]. */
@inline export function clamp(v: f32, lo: f32, hi: f32): f32 {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Linear interpolation. */
@inline export function lerp(a: f32, b: f32, t: f32): f32 {
  return a + (b - a) * t;
}

/** Fractional part in [0, 1) (also for negative inputs). */
@inline export function fract(v: f32): f32 {
  return v - Mathf.floor(v);
}

/** Rounds half away from zero (Rust `f32::round`; JS rounds ties toward +∞). */
@inline export function roundAway(v: f32): f32 {
  return v >= 0.0 ? Mathf.floor(v + 0.5) : -Mathf.floor(-v + 0.5);
}

/** Hermite smoothstep of t ∈ [0, 1]. */
@inline export function smoothstep(t: f32): f32 {
  return t * t * (3.0 - 2.0 * t);
}

/** Stateless hash → [0, 1]. Same as the former engine's `seeded_random`. */
export function seededRandom(seed: u32): f32 {
  let s: u32 = seed ^ 0xdeadbeef;
  s = s * 0x45d9f3b + (s >> 16);
  s = s * 0x45d9f3b + (s >> 16);
  s ^= s >> 16;
  return <f32>s / <f32>u32.MAX_VALUE;
}

/** Hash of (seed, i) → [0, 1). */
export function hash01(seed: u32, i: u32): f32 {
  return seededRandom(seed ^ (i * 0x9e3779b9));
}

/** FNV-1a 32-bit step. */
@inline export function fnv1a(h: u32, v: u32): u32 {
  return (h ^ v) * 0x01000193;
}

/** FNV-1a offset basis. */
export const FNV_OFFSET: u32 = 0x811c9dc5;

/** Stable per-position seed (quantized normalized coords, as the former noise effect). */
export function fnv1aPos(x: f32, y: f32): u32 {
  const xi = <u32><i32>roundAway(x * 10000.0);
  const yi = <u32><i32>roundAway(y * 10000.0);
  return fnv1a(fnv1a(FNV_OFFSET, xi), yi);
}

/** Smoothly blends prev → curr over the first `fade × dur` ms of a step. */
export function crossfade(prev: f32, curr: f32, elapsedMs: f32, durMs: f32, fade: f32): f32 {
  const f = clamp(fade, 0.0, 1.0);
  if (f <= 0.0) return curr;
  const fadeMs = durMs * f;
  if (elapsedMs >= fadeMs) return curr;
  const t = clamp(elapsedMs / fadeMs, 0.0, 1.0);
  return prev + (curr - prev) * smoothstep(t);
}

// ── Perlin noise ────────────────────────────────

/** Ken Perlin's permutation (doubled to 512 entries). */
const PERM_BASE: StaticArray<u8> = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225,
  140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
  247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32,
  57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
  74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122,
  60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
  65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169,
  200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
  52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212,
  207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
  119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
  129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
  218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241,
  81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
  184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93,
  222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
];

/** Permutation lookup with wrap (equivalent to the doubled table). */
@inline function perm(i: i32): i32 {
  return <i32>unchecked(PERM_BASE[i & 255]);
}

@inline function fade(t: f32): f32 {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

/** Gradient table (16 directions) as in the former engine. */
const GX: StaticArray<f32> = [1.0, -1.0, 1.0, -1.0, 1.0, -1.0, 1.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, -1.0, 0.0];
const GY: StaticArray<f32> = [1.0, 1.0, -1.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0, -1.0, 1.0, -1.0, 0.0, 1.0, 0.0, -1.0];

@inline function grad(hash: i32, x: f32, y: f32): f32 {
  const h = hash & 15;
  return unchecked(GX[h]) * x + unchecked(GY[h]) * y;
}

/** Improved Perlin noise 2D, roughly [-1, 1]. */
export function perlin2(x: f32, y: f32): f32 {
  const fx = Mathf.floor(x);
  const fy = Mathf.floor(y);
  const xi = <i32>fx & 255;
  const yi = <i32>fy & 255;
  const xf = x - fx;
  const yf = y - fy;
  const u = fade(xf);
  const v = fade(yf);

  const aa = perm(perm(xi) + yi);
  const ab = perm(perm(xi) + yi + 1);
  const ba = perm(perm((xi + 1) & 255) + yi);
  const bb = perm(perm((xi + 1) & 255) + yi + 1);

  return lerp(
    lerp(grad(aa, xf, yf), grad(ba, xf - 1.0, yf), u),
    lerp(grad(ab, xf, yf - 1.0), grad(bb, xf - 1.0, yf - 1.0), u),
    v,
  );
}

/** 1D noise (Perlin slice), roughly [-1, 1]. */
export function noise1(x: f32): f32 {
  return perlin2(x, 0.0);
}

/** 2D noise, roughly [-1, 1]. */
export function noise2(x: f32, y: f32): f32 {
  return perlin2(x, y);
}

/** 3D noise from two offset 2D slices, roughly [-1, 1]. */
export function noise3(x: f32, y: f32, z: f32): f32 {
  const zf = Mathf.floor(z);
  const t = fade(z - zf);
  const a = perlin2(x + zf * 17.31, y + zf * 31.17);
  const b = perlin2(x + (zf + 1.0) * 17.31, y + (zf + 1.0) * 31.17);
  return lerp(a, b, t);
}

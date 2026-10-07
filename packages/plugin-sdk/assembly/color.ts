/**
 * Color conversions (normalized components). `rgbToHsl`/`hslToRgb` are exact
 * ports of the former engine's color post-process (`engine.rs`). Results are
 * written into a caller-provided `Vec3` to avoid allocations per sample.
 */

/** A reusable triple (r,g,b or h,s,l / h,s,v). */
export class Vec3 {
  x: f32 = 0;
  y: f32 = 0;
  z: f32 = 0;

  /** Sets all three components. */
  @inline set(x: f32, y: f32, z: f32): Vec3 {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
}

/** RGB (0–1) → HSL with h ∈ [0, 1). */
export function rgbToHsl(r: f32, g: f32, b: f32, out: Vec3): Vec3 {
  const max = Mathf.max(Mathf.max(r, g), b);
  const min = Mathf.min(Mathf.min(r, g), b);
  const l = (max + min) / 2.0;
  if (Mathf.abs(max - min) < 1e-6) return out.set(0.0, 0.0, l);
  const d = max - min;
  const s = l > 0.5 ? d / (2.0 - max - min) : d / (max + min);
  let h: f32;
  if (max == r) h = ((g - b) / d + (g < b ? <f32>6.0 : <f32>0.0)) / 6.0;
  else if (max == g) h = ((b - r) / d + 2.0) / 6.0;
  else h = ((r - g) / d + 4.0) / 6.0;
  return out.set(h, s, l);
}

@inline function hueToRgb(p: f32, q: f32, t: f32): f32 {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < <f32>(1.0 / 6.0)) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < <f32>(2.0 / 3.0)) return p + (q - p) * (<f32>(2.0 / 3.0) - t) * 6.0;
  return p;
}

/** HSL (h ∈ [0, 1)) → RGB (0–1). */
export function hslToRgb(h: f32, s: f32, l: f32, out: Vec3): Vec3 {
  if (s < 1e-6) return out.set(l, l, l);
  const q: f32 = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  const p: f32 = 2.0 * l - q;
  return out.set(hueToRgb(p, q, h + <f32>(1.0 / 3.0)), hueToRgb(p, q, h), hueToRgb(p, q, h - <f32>(1.0 / 3.0)));
}

/** HSV (h in degrees, s/v 0–1) → RGB (0–1). */
export function hsvToRgb(hDeg: f32, s: f32, v: f32, out: Vec3): Vec3 {
  const c = v * s;
  let hp = hDeg % 360.0;
  if (hp < 0.0) hp += 360.0;
  hp /= 60.0;
  const x = c * (1.0 - Mathf.abs((hp % 2.0) - 1.0));
  const m = v - c;
  if (hp < 1.0) return out.set(c + m, x + m, m);
  if (hp < 2.0) return out.set(x + m, c + m, m);
  if (hp < 3.0) return out.set(m, c + m, x + m);
  if (hp < 4.0) return out.set(m, x + m, c + m);
  if (hp < 5.0) return out.set(x + m, m, c + m);
  return out.set(c + m, m, x + m);
}

/** RGB (0–1) → HSV (h in degrees, s/v 0–1). */
export function rgbToHsv(r: f32, g: f32, b: f32, out: Vec3): Vec3 {
  const max = Mathf.max(Mathf.max(r, g), b);
  const min = Mathf.min(Mathf.min(r, g), b);
  const d = max - min;
  let h: f32 = 0.0;
  if (d > 0.0) {
    if (max == r) h = ((g - b) / d) % 6.0;
    else if (max == g) h = (b - r) / d + 2.0;
    else h = (r - g) / d + 4.0;
    h *= 60.0;
    if (h < 0.0) h += 360.0;
  }
  return out.set(h, max == 0.0 ? <f32>0.0 : d / max, max);
}

/**
 * Built-in modifier: Noise (plan M9, revised after review). Output `scale`
 * (levels are fractions of the programmed value). With r = timePhase (one
 * random step per unit):
 *
 * key: who shares one random value, from the spread (ABI v1.2) — All the
 *   same: the whole rig; Fixture by fixture: every number (all heads of a
 *   fixture, symmetric pairs); Spatial 2D / Within each fixture: every pixel.
 * level: every random value u (each step of the key, and the coherent noise
 *   texture) is shaped before it is used:
 *   - `frequency` bends it, b = u^k with k = ln ½ / ln(1 − f), so exactly
 *     the share f of the values lies above one half ("how often it is
 *     bright"; 0.5 keeps the values even);
 *   - `variation` pushes b away from the middle, c = ½ + (b − ½) / variation
 *     (clamped): 0 = on/off (above half → high, below → low), 1 = soft levels.
 *   Steps crossfade by 1 − hardness, timing is jittered by 1 − sync,
 *   `coherence` blends toward a Perlin texture (neighbours form patches,
 *   even in every direction; Spatial 2D: the handle length sets their size,
 *   its direction the drift — radial: outward); the result maps into
 *   [rangeMin, rangeMax].
 *
 * Param slots: rangeMin 0, rangeMax 1, frequency 2, variation 3,
 * coherence 4, sync 5, hardness 6, colorVariation 7.
 */
import { Modifier, Frame, Sample, Out, Params, register, hash01, noise3, clamp, lerp, SPREAD_SAME, SPREAD_ORDER, SPREAD_SPATIAL } from "@pixelmapper/plugin-sdk";

/** Hermite smoothstep on [0, 1]. */
@inline function smooth(t: f32): f32 {
  const c = clamp(t, 0.0, 1.0);
  return c * c * (3.0 - 2.0 * c);
}

class Noise extends Modifier {
  rangeMin: f32 = 0;
  rangeMax: f32 = 1;
  frequency: f32 = 0.5;
  /** Bend exponent: (1 − f)^k = ½. */
  k: f32 = 1;
  variation: f32 = 1;
  coherence: f32 = 0;
  sync: f32 = 0;
  hardness: f32 = 0;
  cv: f32 = 0;

  prepare(p: Params): void {
    this.rangeMin = clamp(p.get(0), 0.0, 1.0);
    this.rangeMax = clamp(p.get(1), 0.0, 1.0);
    this.frequency = clamp(p.get(2), 0.01, 0.99);
    this.k = Mathf.log(0.5) / Mathf.log(<f32>1.0 - this.frequency);
    this.variation = clamp(p.get(3), 0.0, 1.0);
    this.coherence = clamp(p.get(4), 0.0, 1.0);
    this.sync = clamp(p.get(5), 0.0, 1.0);
    this.hardness = clamp(p.get(6), 0.0, 1.0);
    this.cv = clamp(p.get(7), 0.0, 1.0);
  }

  /** Shapes an even random value: frequency bend, then variation contrast. */
  shape(u: f32): f32 {
    const b = Mathf.pow(clamp(u, 0.0, 1.0), this.k);
    if (this.variation >= 1.0) return b;
    return clamp(0.5 + (b - 0.5) / Mathf.max(this.variation, 1e-3), 0.0, 1.0);
  }

  /** Shaped random steps of one key at (jittered) time t, 0–1. */
  steps(key: u32, t: f32): f32 {
    const kf = Mathf.floor(t);
    const f = t - kf;
    const k = <u32>(<i32>kf);
    const a = this.shape(hash01(key, k * 2 + 7));
    const w: f32 = <f32>1.0 - this.hardness;
    if (f < 1.0 - w) return a;
    const b = this.shape(hash01(key, (k + 1) * 2 + 7));
    return lerp(a, b, smooth((f - (1.0 - w)) / Mathf.max(w, 1e-3)));
  }

  /** Level of one key (shaped steps → coherence → range), 0–1. */
  level(key: u32, texSeed: u32, ctx: Frame, s: Sample, t: f32, r: f32): f32 {
    let v = this.steps(key, t);
    if (this.coherence > 0.0) {
      const o = <f32>(texSeed & 0xff) * 0.37;
      let S = lerp(8.0, 2.5, this.coherence);
      let qx: f32 = s.spatial * S + o;
      let qy: f32 = o;
      let qz: f32 = r;
      if (ctx.spread == SPREAD_SPATIAL) {
        // Patches on the stage: the handle length scales them (0.5 = the base
        // size), its direction is where they drift (radial: away from the origin).
        const dx = ctx.handleEndX - ctx.handleOriginX;
        const dy = ctx.handleEndY - ctx.handleOriginY;
        const len = Mathf.max(Mathf.sqrt(dx * dx + dy * dy), 0.02);
        S = S * 0.5 / len;
        const rx = s.x - ctx.handleOriginX;
        const ry = s.y - ctx.handleOriginY;
        const dist = Mathf.sqrt(rx * rx + ry * ry);
        // Linear and radial give different spatial values: the closer one is the mode.
        const along = (rx * dx + ry * dy) / (len * len);
        const radial = Mathf.abs(s.spatial - dist / len) < Mathf.abs(s.spatial - along);
        let ux: f32 = dx / len;
        let uy: f32 = dy / len;
        if (radial) {
          ux = dist > 1e-4 ? rx / dist : 0.0;
          uy = dist > 1e-4 ? ry / dist : 0.0;
        }
        // Drift half a patch per step; the texture itself changes slower so the drift reads.
        qx = s.x * S + o - ux * r * 0.5;
        qy = s.y * S + o - uy * r * 0.5;
        qz = r * 0.35;
      }
      // Time is the only third axis: tying it to `spatial` drew bands across the handle.
      // Perlin values cluster around 0: stretch so coherent looks use their range.
      const coh = noise3(qx, qy, qz) * 0.7 + 0.5;
      v = lerp(v, this.shape(coh), this.coherence);
    }
    return this.rangeMin + (this.rangeMax - this.rangeMin) * v;
  }

  render(ctx: Frame, s: Sample, out: Out): void {
    const r = ctx.timePhase;
    let key: u32 = s.seed;
    if (ctx.spread == SPREAD_SAME) key = ctx.seed & 0xffffff;
    else if (ctx.spread == SPREAD_ORDER && s.rank >= 0) key = <u32>(hash01(ctx.seed, <u32>s.rank + 977) * 16777215.0);
    // Timing jitter per key (sync 1: everything steps on the beat).
    const t = r + hash01(key, 1) * (1.0 - this.sync);
    let v = this.level(key, ctx.seed, ctx, s, t, r);
    if (this.cv > 0.0) {
      const ck = key ^ (s.channelSeed * 0x9e3779b9);
      v = lerp(v, this.level(ck, s.channelSeed, ctx, s, r + hash01(ck, 1) * (1.0 - this.sync), r), this.cv);
    }
    out.set(0, clamp(v, 0.0, 1.0));
  }
}

register(new Noise());

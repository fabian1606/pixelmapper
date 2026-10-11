/**
 * Built-in modifier: Noise (plan M9, revised after review). Output `scale`
 * (levels are fractions of the programmed value). With r = timePhase (one
 * random step per unit):
 *
 * key: who shares one random value, from the spread (ABI v1.2) — All the
 *   same: the whole rig; Fixture by fixture: every number (all heads of a
 *   fixture, symmetric pairs); Spatial 2D / Within each fixture: every pixel.
 * level: random steps of the key (timing jittered by 1 − sync, crossfade by
 *   1 − hardness), blended toward a coherent noise texture by `coherence`
 *   (neighbours along the spread form patches that flow along it), bent by
 *   `frequency` (the share of the time it is bright: u^(1/f − 1) below one
 *   half, 1 − (1 − u)^(1/(1 − f) − 1) above; the mean level is f, 0.5 keeps
 *   the levels even), deepened by `variation` (0 = every unit sits at the
 *   top of the range, 1 = the whole range: d = 1 − variation · (1 − level)),
 *   mapped into [rangeMin, rangeMax].
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
  variation: f32 = 1;
  coherence: f32 = 0;
  sync: f32 = 0;
  hardness: f32 = 0;
  cv: f32 = 0;

  prepare(p: Params): void {
    this.rangeMin = clamp(p.get(0), 0.0, 1.0);
    this.rangeMax = clamp(p.get(1), 0.0, 1.0);
    this.frequency = clamp(p.get(2), 0.01, 0.99);
    this.variation = clamp(p.get(3), 0.0, 1.0);
    this.coherence = clamp(p.get(4), 0.0, 1.0);
    this.sync = clamp(p.get(5), 0.0, 1.0);
    this.hardness = clamp(p.get(6), 0.0, 1.0);
    this.cv = clamp(p.get(7), 0.0, 1.0);
  }

  /** Random steps of one key at (jittered) time t, 0–1. */
  steps(key: u32, t: f32): f32 {
    const kf = Mathf.floor(t);
    const f = t - kf;
    const k = <u32>(<i32>kf);
    const a = hash01(key, k * 2 + 7);
    const w: f32 = <f32>1.0 - this.hardness;
    if (f < 1.0 - w) return a;
    const b = hash01(key, (k + 1) * 2 + 7);
    return lerp(a, b, smooth((f - (1.0 - w)) / Mathf.max(w, 1e-3)));
  }

  /** Bends an even 0–1 level so that its mean is the frequency. */
  bend(u: f32): f32 {
    const f = this.frequency;
    if (f <= 0.5) return Mathf.pow(u, <f32>1.0 / f - 1.0);
    return <f32>1.0 - Mathf.pow(<f32>1.0 - u, <f32>1.0 / (<f32>1.0 - f) - 1.0);
  }

  /** Level of one key (steps → coherence → frequency → variation → range), 0–1. */
  level(key: u32, texSeed: u32, ctx: Frame, s: Sample, t: f32, r: f32): f32 {
    let v = this.steps(key, t);
    if (this.coherence > 0.0) {
      const S = lerp(8.0, 0.6, this.coherence);
      const o = <f32>(texSeed & 0xff) * 0.37;
      // Spatial 2D: patches on the stage; otherwise along the spread only (whole fixtures share it).
      const px: f32 = ctx.spread == SPREAD_SPATIAL ? s.x : s.spatial;
      const py: f32 = ctx.spread == SPREAD_SPATIAL ? s.y : 0.0;
      // Perlin values cluster around 0: stretch so coherent looks use their range.
      const coh = noise3(px * S + o, py * S + o, s.spatial * S - r) * 0.7 + 0.5;
      v = lerp(v, clamp(coh, 0.0, 1.0), this.coherence);
    }
    const d: f32 = <f32>1.0 - this.variation * (<f32>1.0 - this.bend(clamp(v, 0.0, 1.0)));
    return this.rangeMin + (this.rangeMax - this.rangeMin) * d;
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

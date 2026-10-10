/**
 * Built-in modifier: Noise (plan M9). Output `scale` (levels are fractions
 * of the programmed value). With r = timePhase (one random step per unit):
 *
 * level: per-sample random steps (timing jittered by 1 − sync, crossfade by
 *   1 − hardness) blended toward a coherent noise texture by `coherence`
 *   (the texture flows along the distribution's spatial); occasional events
 *   (rate per unit, length in units) pulse up or dip down; the result maps
 *   into [rangeMin, rangeMax].
 * pick: each step a random set of `count` numbered fixtures is on
 *   (count 0 = a third, rounded up), crossfading by 1 − hardness.
 *
 * Param slots: mode 0, rangeMin 1, rangeMax 2, eventRate 3, eventLength 4,
 * eventDir 5, coherence 6, sync 7, hardness 8, count 9, colorVariation 10.
 */
import { Modifier, Frame, Sample, Out, Params, register, hash01, noise3, clamp, lerp } from "@pixelmapper/plugin-sdk";

/** Hermite smoothstep on [0, 1]. */
@inline function smooth(t: f32): f32 {
  const c = clamp(t, 0.0, 1.0);
  return c * c * (3.0 - 2.0 * c);
}

class Noise extends Modifier {
  pick: bool = false;
  rangeMin: f32 = 0;
  rangeMax: f32 = 1;
  eventRate: f32 = 0;
  eventLength: f32 = 0.1;
  eventUp: bool = true;
  coherence: f32 = 0;
  sync: f32 = 0;
  hardness: f32 = 0;
  count: i32 = 0;
  cv: f32 = 0;

  prepare(p: Params): void {
    this.pick = p.int(0) == 1;
    this.rangeMin = clamp(p.get(1), 0.0, 1.0);
    this.rangeMax = clamp(p.get(2), 0.0, 1.0);
    this.eventRate = clamp(p.get(3), 0.0, 1.0);
    this.eventLength = Mathf.max(p.get(4), 0.02);
    this.eventUp = p.int(5) == 0;
    this.coherence = clamp(p.get(6), 0.0, 1.0);
    this.sync = clamp(p.get(7), 0.0, 1.0);
    this.hardness = clamp(p.get(8), 0.0, 1.0);
    this.count = p.int(9);
    this.cv = clamp(p.get(10), 0.0, 1.0);
  }

  /** Independent random steps of one seed at time r (0–1). */
  steps(seed: u32, r: f32): f32 {
    const j = hash01(seed, 1) * (1.0 - this.sync);
    const t = r + j;
    const kf = Mathf.floor(t);
    const f = t - kf;
    const k = <u32>(<i32>kf);
    const a = hash01(seed, k * 2 + 7);
    const w: f32 = <f32>1.0 - this.hardness;
    if (f < 1.0 - w) return a;
    const b = hash01(seed, (k + 1) * 2 + 7);
    return lerp(a, b, smooth((f - (1.0 - w)) / Mathf.max(w, 1e-3)));
  }

  /** Level of one seed (steps → coherence → events), 0–1. */
  level(seed: u32, s: Sample, r: f32): f32 {
    let v = this.steps(seed, r);
    if (this.coherence > 0.0) {
      const S = lerp(8.0, 0.6, this.coherence);
      const o = <f32>(seed & 0xff) * 0.37;
      // Perlin values cluster around 0: stretch so coherent looks use their range.
      const coh = noise3(s.x * S + o, s.y * S, s.spatial * S - r) * 0.7 + 0.5;
      v = lerp(v, clamp(coh, 0.0, 1.0), this.coherence);
    }
    if (this.eventRate > 0.0) {
      const len = this.eventLength;
      const e = Mathf.floor(r / len);
      if (hash01(seed, <u32>(<i32>e) * 3 + 101) < this.eventRate * len) {
        const local = r / len - e;
        const pulse: f32 = local < 0.1 ? local / 0.1 : 1.0 - (local - 0.1) / 0.9;
        v = this.eventUp ? Mathf.max(v, pulse) : v * (1.0 - pulse);
      }
    }
    return v;
  }

  /** On (1) / off (0) of a rank in the random pick of step k. */
  picked(seed: u32, k: u32, rank: i32, ranks: i32, n: i32): f32 {
    const key = hash01(seed ^ (k * 0x9e3779b9), <u32>rank);
    let below = 0;
    for (let i = 0; i < ranks; i++) {
      if (hash01(seed ^ (k * 0x9e3779b9), <u32>i) < key) below++;
    }
    return below < n ? 1.0 : 0.0;
  }

  render(ctx: Frame, s: Sample, out: Out): void {
    const r = ctx.timePhase;
    if (this.pick) {
      let rank = s.rank;
      let ranks = ctx.rankCount;
      if (rank < 0 || ranks <= 0) { rank = s.groupIndex; ranks = s.groupCount; }
      const n = this.count > 0 ? this.count : <i32>Mathf.ceil(<f32>ranks / 3.0);
      const kf = Mathf.floor(r);
      const f = r - kf;
      const k = <u32>(<i32>kf);
      let v = this.picked(ctx.seed, k, rank, ranks, n);
      const w: f32 = <f32>1.0 - this.hardness;
      if (w > 0.0 && f > 1.0 - w) v = lerp(v, this.picked(ctx.seed, k + 1, rank, ranks, n), smooth((f - (1.0 - w)) / w));
      out.set(0, v);
      return;
    }
    const seed = s.seed;
    let v = this.level(seed, s, r);
    if (this.cv > 0.0) v = lerp(v, this.level(seed ^ (s.channelSeed * 0x9e3779b9), s, r), this.cv);
    out.set(0, clamp(this.rangeMin + (this.rangeMax - this.rangeMin) * v, 0.0, 1.0));
  }
}

register(new Noise());

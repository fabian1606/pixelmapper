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
 *   (neighbours along the spread form patches that flow along it), mapped
 *   into [rangeMin, rangeMax].
 * peaks: each slot of `eventLength` steps holds a peak with probability
 *   frequency · length (fixture by fixture with enough numbers: exactly that
 *   share of the numbers, so a step is never empty); a peak rises to full
 *   (up) or dips to dark (down); hardness squares its edges.
 *
 * Param slots: rangeMin 0, rangeMax 1, frequency (eventRate) 2,
 * eventLength 3, eventDir 4, coherence 5, sync 6, hardness 7,
 * colorVariation 8.
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
  frequency: f32 = 0;
  eventLength: f32 = 0.1;
  eventUp: bool = true;
  coherence: f32 = 0;
  sync: f32 = 0;
  hardness: f32 = 0;
  cv: f32 = 0;

  prepare(p: Params): void {
    this.rangeMin = clamp(p.get(0), 0.0, 1.0);
    this.rangeMax = clamp(p.get(1), 0.0, 1.0);
    this.frequency = clamp(p.get(2), 0.0, 1.0);
    this.eventLength = clamp(p.get(3), 0.02, 1.0);
    this.eventUp = p.int(4) == 0;
    this.coherence = clamp(p.get(5), 0.0, 1.0);
    this.sync = clamp(p.get(6), 0.0, 1.0);
    this.hardness = clamp(p.get(7), 0.0, 1.0);
    this.cv = clamp(p.get(8), 0.0, 1.0);
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

  /** Level of one key (steps → coherence → range), 0–1. */
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
    return this.rangeMin + (this.rangeMax - this.rangeMin) * v;
  }

  /** On (1) / off (0) of a number in the exact pick of slot e. */
  picked(seed: u32, e: u32, rank: i32, ranks: i32, n: i32): f32 {
    const pickSeed = seed ^ (e * 0x9e3779b9);
    const mine = hash01(pickSeed, <u32>rank);
    let below = 0;
    for (let i = 0; i < ranks; i++) {
      if (hash01(pickSeed, <u32>i) < mine) below++;
    }
    return below < n ? 1.0 : 0.0;
  }

  /** Peak envelope (0–1) of a key at time t, 0 outside peaks. */
  peak(key: u32, ctx: Frame, s: Sample, t: f32): f32 {
    if (this.frequency <= 0.0) return 0.0;
    const len = this.eventLength;
    const ef = Mathf.floor(t / len);
    const e = <u32>(<i32>ef);
    const p = this.frequency * len;
    let on = false;
    const ranks = ctx.rankCount;
    if (ctx.spread == SPREAD_ORDER && s.rank >= 0 && <f32>ranks * p >= 1.0) {
      on = this.picked(ctx.seed, e, s.rank, ranks, <i32>Mathf.round(<f32>ranks * p)) > 0.5;
    } else {
      on = hash01(key, e * 3 + 101) < p;
    }
    if (!on) return 0.0;
    const local = t / len - ef;
    const soft: f32 = <f32>1.0 - this.hardness;
    const attack: f32 = 0.1 * soft;
    const decay: f32 = 0.9 * soft;
    if (local < attack) return local / attack;
    if (local > 1.0 - decay) return (1.0 - local) / decay;
    return 1.0;
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
    const pulse = this.peak(key, ctx, s, t);
    if (pulse > 0.0) v = this.eventUp ? Mathf.max(v, pulse) : v * (1.0 - pulse);
    out.set(0, clamp(v, 0.0, 1.0));
  }
}

register(new Noise());
